import type {
  AgentRunControlGraphTurnDirectives,
  AgentRunMobileControllerRecoveryState,
} from '../../types/agentRun';
import type { ToolEffectDigest } from '../../types/toolEffectReceipt';
import { sha256HexUtf8 } from '../../utils/sha256';
import type {
  MobileControllerAction,
  MobileControllerCoordinateTarget,
  MobileControllerTarget,
} from '../mobileController/contracts';
import { MOBILE_UI_ACTION_TOOL_NAME } from '../mobileController/contracts';
import type { MobileControllerExecutionBinding } from '../mobileController/runtimeBinding';
import { qualifyMobileControllerAction } from '../mobileController/validation';
import { resolveRegisteredToolName } from '../tools/toolNameNormalization';
import { MAX_AGENT_RUN_AUTOMATIC_RECOVERY_ATTEMPTS } from './foregroundRun/automaticRecoveryBudget';

export const MOBILE_CONTROLLER_STALL_THRESHOLD = 3;
const MOBILE_CONTROLLER_COORDINATE_REGION_COUNT = 20;

type ProposedToolCall = Readonly<{
  id: string;
  name: string;
  arguments: string;
}>;

export type MobileControllerRecoveryPreflightDecision =
  | Readonly<{ kind: 'not_applicable' }>
  | Readonly<{
      kind: 'allow';
      directives: Partial<AgentRunControlGraphTurnDirectives>;
      reason: string;
    }>
  | Readonly<{
      kind: 'block';
      blocker: string;
      closesRecovery: boolean;
      directives: Partial<AgentRunControlGraphTurnDirectives>;
      reason: string;
    }>;

export type MobileControllerRecoveryOutcomeProjection =
  | Readonly<{ kind: 'unchanged' }>
  | Readonly<{ kind: 'clear' }>
  | Readonly<{ kind: 'replace'; state: AgentRunMobileControllerRecoveryState }>;

export type MobileControllerRecoverySignal = Readonly<{
  version: 1;
  consecutiveStalls: number;
  strategyFingerprint: ToolEffectDigest;
  requiredResponse:
    | 'change_strategy_or_report_blocker'
    | 'report_blocker_or_request_takeover'
    | 'reconcile_uncertain_outcome';
}>;

function digest(value: string): ToolEffectDigest {
  return `sha256:${sha256HexUtf8(value)}`;
}

function coordinateRegion(
  target: MobileControllerCoordinateTarget,
  coordinateScale: number,
): readonly [number, number] {
  const regionFor = (value: number): number =>
    Math.min(
      MOBILE_CONTROLLER_COORDINATE_REGION_COUNT - 1,
      Math.floor((value * MOBILE_CONTROLLER_COORDINATE_REGION_COUNT) / coordinateScale),
    );
  return [regionFor(target.x), regionFor(target.y)];
}

function targetSignature(
  target: MobileControllerTarget,
  coordinateScale: number,
): ReadonlyArray<string | number> {
  return target.kind === 'element'
    ? ['element', sha256HexUtf8(target.elementId)]
    : ['region', ...coordinateRegion(target, coordinateScale)];
}

function actionSignature(
  action: MobileControllerAction,
  coordinateScale: number,
): ReadonlyArray<unknown> | null {
  if (action.kind === 'wait') return null;
  if (action.kind === 'activate' || action.kind === 'double_tap' || action.kind === 'long_press') {
    return [action.kind, ...targetSignature(action.target, coordinateScale)];
  }
  if (action.kind === 'drag') {
    return [
      action.kind,
      ...coordinateRegion(action.start, coordinateScale),
      ...coordinateRegion(action.end, coordinateScale),
    ];
  }
  if (action.kind === 'input_text') {
    return [action.kind, sha256HexUtf8(action.text)];
  }
  if (action.kind === 'open_app') {
    return [action.kind, sha256HexUtf8(action.appId)];
  }
  if (action.kind === 'scroll') return [action.kind, action.direction];
  return [action.kind];
}

export function buildMobileControllerStrategyFingerprint(params: {
  action: MobileControllerAction;
  binding: MobileControllerExecutionBinding;
}): ToolEffectDigest | null {
  const action = actionSignature(
    params.action,
    params.binding.capability.normalizedCoordinateScale,
  );
  if (!action) return null;
  return digest(
    JSON.stringify({
      version: 1,
      route: [
        params.binding.currentObservation.appId ?? '',
        params.binding.currentObservation.windowId ?? '',
      ],
      action,
    }),
  );
}

function parseProposedFingerprint(
  toolCall: ProposedToolCall,
  binding: MobileControllerExecutionBinding,
): ToolEffectDigest | null {
  if (resolveRegisteredToolName(toolCall.name) !== MOBILE_UI_ACTION_TOOL_NAME) return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(toolCall.arguments);
  } catch {
    return null;
  }
  const action = qualifyMobileControllerAction(candidate, binding.capability);
  return action ? buildMobileControllerStrategyFingerprint({ action, binding }) : null;
}

function recoveryBlocker(params: {
  reason: 'equivalent_strategy_stalled' | 'recovery_exhausted' | 'outcome_uncertain';
  state: AgentRunMobileControllerRecoveryState;
}): string {
  return [
    'Blocked: the mobile controller recovery policy prevented another external action.',
    '<mobile_controller_recovery>',
    JSON.stringify({
      version: 1,
      reason: params.reason,
      phase: params.state.phase,
      strategyFingerprint: params.state.strategyFingerprint,
      ...('blockedStrategyFingerprint' in params.state
        ? { blockedStrategyFingerprint: params.state.blockedStrategyFingerprint }
        : {}),
    }),
    '</mobile_controller_recovery>',
    params.reason === 'equivalent_strategy_stalled'
      ? 'Re-observe and choose a materially different action, target, or route.'
      : 'Do not retry the side effect. Report the concrete blocker or request user takeover.',
  ].join('\n');
}

function closeRecovery(
  state: AgentRunMobileControllerRecoveryState,
  reason: 'recovery_exhausted' | 'outcome_uncertain',
): MobileControllerRecoveryPreflightDecision {
  return {
    kind: 'block',
    blocker: recoveryBlocker({ reason, state }),
    closesRecovery: true,
    directives: {
      forceFinalText: true,
      forcedTextReason: 'execution_loop_recovery',
      mobileControllerRecovery: state,
    },
    reason: `mobile_controller_${reason}`,
  };
}

export function resolveMobileControllerRecoveryPreflight(params: {
  toolCall: ProposedToolCall;
  binding: MobileControllerExecutionBinding | undefined;
  directives: AgentRunControlGraphTurnDirectives;
}): MobileControllerRecoveryPreflightDecision {
  if (!params.binding) return { kind: 'not_applicable' };
  const strategyFingerprint = parseProposedFingerprint(params.toolCall, params.binding);
  if (!strategyFingerprint) return { kind: 'not_applicable' };

  const state = params.directives.mobileControllerRecovery;
  if (
    state?.phase === 'action_in_flight' ||
    state?.phase === 'recovery_in_flight' ||
    state?.phase === 'recovery_stalled'
  ) {
    return closeRecovery(state, 'recovery_exhausted');
  }
  if (state?.phase === 'outcome_uncertain' || state?.phase === 'recovery_uncertain') {
    return closeRecovery(state, 'outcome_uncertain');
  }
  if (state?.phase === 'strategy_change_required') {
    if (strategyFingerprint === state.strategyFingerprint) {
      return closeRecovery(state, 'recovery_exhausted');
    }
    return {
      kind: 'allow',
      directives: {
        mobileControllerRecovery: {
          version: 1,
          phase: 'recovery_in_flight',
          strategyFingerprint,
          blockedStrategyFingerprint: state.strategyFingerprint,
          toolCallId: params.toolCall.id,
        },
      },
      reason: 'mobile_controller_alternative_strategy_started',
    };
  }

  if (
    state?.phase === 'tracking' &&
    state.consecutiveStallCount >= MOBILE_CONTROLLER_STALL_THRESHOLD
  ) {
    const attemptCount = params.directives.automaticRecoveryAttemptCount ?? 0;
    if (attemptCount >= MAX_AGENT_RUN_AUTOMATIC_RECOVERY_ATTEMPTS) {
      return closeRecovery(state, 'recovery_exhausted');
    }
    const recoveryDirectives = {
      automaticRecoveryAttemptCount: attemptCount + 1,
    } as const;
    if (strategyFingerprint === state.strategyFingerprint) {
      const blockedState: AgentRunMobileControllerRecoveryState = {
        version: 1,
        phase: 'strategy_change_required',
        strategyFingerprint: state.strategyFingerprint,
        consecutiveStallCount: MOBILE_CONTROLLER_STALL_THRESHOLD,
      };
      return {
        kind: 'block',
        blocker: recoveryBlocker({
          reason: 'equivalent_strategy_stalled',
          state: blockedState,
        }),
        closesRecovery: false,
        directives: {
          ...recoveryDirectives,
          mobileControllerRecovery: blockedState,
        },
        reason: 'mobile_controller_strategy_change_required',
      };
    }
    return {
      kind: 'allow',
      directives: {
        ...recoveryDirectives,
        mobileControllerRecovery: {
          version: 1,
          phase: 'recovery_in_flight',
          strategyFingerprint,
          blockedStrategyFingerprint: state.strategyFingerprint,
          toolCallId: params.toolCall.id,
        },
      },
      reason: 'mobile_controller_alternative_strategy_started',
    };
  }

  const previousStallCount =
    state?.phase === 'tracking' && state.strategyFingerprint === strategyFingerprint
      ? state.consecutiveStallCount
      : 0;
  return {
    kind: 'allow',
    directives: {
      mobileControllerRecovery: {
        version: 1,
        phase: 'action_in_flight',
        strategyFingerprint,
        consecutiveStallCount: previousStallCount,
        toolCallId: params.toolCall.id,
      },
    },
    reason: 'mobile_controller_action_progress_tracking_started',
  };
}

function classifyOutcome(content: string): 'changed' | 'stalled' | 'uncertain' {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return 'uncertain';
  }
  if (value.version !== 1) return 'uncertain';
  if (
    value.executionState === 'completed' &&
    value.effectState === 'applied' &&
    (value.verificationState === 'acknowledged' || value.verificationState === 'verified')
  ) {
    if (value.observableDelta === 'changed') return 'changed';
    if (value.observableDelta === 'unchanged') return 'stalled';
  }
  return value.executionState === 'failed' && value.effectState === 'failed'
    ? 'stalled'
    : 'uncertain';
}

export function projectMobileControllerRecoveryOutcome(params: {
  state: AgentRunMobileControllerRecoveryState | undefined;
  toolCallId: string;
  content: string;
}): MobileControllerRecoveryOutcomeProjection {
  const state = params.state;
  if (
    !state ||
    (state.phase !== 'action_in_flight' && state.phase !== 'recovery_in_flight') ||
    state.toolCallId !== params.toolCallId
  ) {
    return { kind: 'unchanged' };
  }
  const outcome = classifyOutcome(params.content);
  if (outcome === 'changed') return { kind: 'clear' };
  if (state.phase === 'action_in_flight') {
    return outcome === 'stalled'
      ? {
          kind: 'replace',
          state: {
            version: 1,
            phase: 'tracking',
            strategyFingerprint: state.strategyFingerprint,
            consecutiveStallCount: Math.min(
              MOBILE_CONTROLLER_STALL_THRESHOLD,
              state.consecutiveStallCount + 1,
            ),
          },
        }
      : {
          kind: 'replace',
          state: {
            version: 1,
            phase: 'outcome_uncertain',
            strategyFingerprint: state.strategyFingerprint,
          },
        };
  }
  return {
    kind: 'replace',
    state: {
      version: 1,
      phase: outcome === 'stalled' ? 'recovery_stalled' : 'recovery_uncertain',
      strategyFingerprint: state.strategyFingerprint,
      blockedStrategyFingerprint: state.blockedStrategyFingerprint,
    },
  };
}

export function resolveMobileControllerRecoverySignal(
  state: AgentRunMobileControllerRecoveryState | undefined,
): MobileControllerRecoverySignal | null {
  if (
    state?.phase === 'tracking' &&
    state.consecutiveStallCount >= MOBILE_CONTROLLER_STALL_THRESHOLD
  ) {
    return {
      version: 1,
      consecutiveStalls: state.consecutiveStallCount,
      strategyFingerprint: state.strategyFingerprint,
      requiredResponse: 'change_strategy_or_report_blocker',
    };
  }
  if (state?.phase === 'strategy_change_required') {
    return {
      version: 1,
      consecutiveStalls: state.consecutiveStallCount,
      strategyFingerprint: state.strategyFingerprint,
      requiredResponse: 'change_strategy_or_report_blocker',
    };
  }
  if (state?.phase === 'recovery_stalled') {
    return {
      version: 1,
      consecutiveStalls: 1,
      strategyFingerprint: state.strategyFingerprint,
      requiredResponse: 'report_blocker_or_request_takeover',
    };
  }
  if (state?.phase === 'outcome_uncertain' || state?.phase === 'recovery_uncertain') {
    return {
      version: 1,
      consecutiveStalls: 0,
      strategyFingerprint: state.strategyFingerprint,
      requiredResponse: 'reconcile_uncertain_outcome',
    };
  }
  return null;
}
