import type {
  AgentRunControlGraphAuditEvent,
  AgentRunAsyncOperation,
  AgentRunControlGraphAsyncWorkState,
  AgentRunControlGraphForcedTextReason,
  AgentRunControlGraphPerformance,
  AgentRunControlGraphState,
  AgentRunControlGraphStatus,
  AgentRunControlGraphToolCallRef,
  AgentRunControlGraphToolResultRef,
  AgentRunControlGraphTurnDirectives,
  AgentRunMobileControllerRecoveryState,
  AgentRunTurnLatency,
} from '../../types/agentRun';
import { AGENT_RUN_TURN_LATENCY_STAGES } from '../../types/agentRun';
import { normalizeAgentPlan } from '../../engine/plan/agentPlan';
import { normalizeToolNameList } from '../../engine/tools/toolNameNormalization';
import {
  normalizeAgentRunControlGraphAsyncWorkState,
  normalizeAgentRunAsyncOperations,
} from './agentRunAsyncState';
import { normalizeRequestUnderstandingSnapshot } from './requestUnderstandingProjection';
import { normalizeAgentControlGraphPendingUserInput } from './agentControlGraphClarificationState';

export const AGENT_RUN_CONTROL_GRAPH_VERSION = 1;
export const MAX_AGENT_RUN_CONTROL_GRAPH_AUDIT_EVENTS = 128;
export const AGENT_RUN_CONTROL_GRAPH_TERMINAL_STATUSES = new Set<AgentRunControlGraphStatus>([
  'blocked',
  'finalized',
  'yielded',
  'cancelled',
  'failed',
]);

const CONTROL_GRAPH_STATUSES = new Set<AgentRunControlGraphStatus>([
  'ready',
  'model_turn',
  'awaiting_tool_results',
  'recovering',
  'waiting_async',
  'awaiting_user',
  'awaiting_review',
  'blocked',
  'finalized',
  'yielded',
  'cancelled',
  'failed',
]);

/**
 * Keyed by the reason type, so a new reason cannot be added without listing it here. A
 * hand-kept set drifted: it lacked `foreground_budget_checkpoint`, so the engine read the
 * checkpoint back as no reason and the stored run lost it.
 */
const FORCED_TEXT_REASON_KEYS: Record<AgentRunControlGraphForcedTextReason, true> = {
  background_session_started: true,
  empty_delivery_recovery: true,
  execution_loop_recovery: true,
  foreground_budget_checkpoint: true,
  incomplete_delivery_continuation: true,
  loop_recovery: true,
  request_clarification: true,
  request_consent: true,
  request_decline: true,
  request_wait: true,
  yield_finalization: true,
};
const FORCED_TEXT_REASONS: ReadonlySet<string> = new Set(Object.keys(FORCED_TEXT_REASON_KEYS));

const TOOL_EFFECT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_MOBILE_CONTROLLER_STALL_COUNT = 3;

function normalizeTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeOptionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isDefinedText(value: string | undefined): value is string {
  return value !== undefined;
}

function normalizeForcedTextReason(
  value: unknown,
): AgentRunControlGraphForcedTextReason | undefined {
  return typeof value === 'string' && FORCED_TEXT_REASONS.has(value)
    ? (value as AgentRunControlGraphForcedTextReason)
    : undefined;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function normalizeMobileControllerRecoveryState(
  value: AgentRunMobileControllerRecoveryState | undefined,
): AgentRunMobileControllerRecoveryState | undefined {
  if (
    !value ||
    value.version !== 1 ||
    !TOOL_EFFECT_DIGEST_PATTERN.test(value.strategyFingerprint)
  ) {
    return undefined;
  }
  const strategyFingerprint = value.strategyFingerprint;
  const consecutiveStallCount = Math.min(
    MAX_MOBILE_CONTROLLER_STALL_COUNT,
    normalizeNonNegativeInteger(
      'consecutiveStallCount' in value ? value.consecutiveStallCount : undefined,
    ),
  );
  const toolCallId =
    'toolCallId' in value ? normalizeOptionalText(value.toolCallId)?.slice(0, 512) : undefined;
  const blockedStrategyFingerprint =
    'blockedStrategyFingerprint' in value &&
    TOOL_EFFECT_DIGEST_PATTERN.test(value.blockedStrategyFingerprint)
      ? value.blockedStrategyFingerprint
      : undefined;

  if (value.phase === 'action_in_flight' && toolCallId) {
    return {
      version: 1,
      phase: value.phase,
      strategyFingerprint,
      consecutiveStallCount,
      toolCallId,
    };
  }
  if (value.phase === 'tracking' && consecutiveStallCount > 0) {
    return { version: 1, phase: value.phase, strategyFingerprint, consecutiveStallCount };
  }
  if (
    value.phase === 'strategy_change_required' &&
    consecutiveStallCount === MAX_MOBILE_CONTROLLER_STALL_COUNT
  ) {
    return { version: 1, phase: value.phase, strategyFingerprint, consecutiveStallCount };
  }
  if (value.phase === 'recovery_in_flight' && blockedStrategyFingerprint && toolCallId) {
    return {
      version: 1,
      phase: value.phase,
      strategyFingerprint,
      blockedStrategyFingerprint,
      toolCallId,
    };
  }
  if (
    (value.phase === 'recovery_stalled' || value.phase === 'recovery_uncertain') &&
    blockedStrategyFingerprint
  ) {
    return {
      version: 1,
      phase: value.phase,
      strategyFingerprint,
      blockedStrategyFingerprint,
    };
  }
  return value.phase === 'outcome_uncertain'
    ? { version: 1, phase: value.phase, strategyFingerprint }
    : undefined;
}

/** Keeps only known stages with finite, non-negative offsets; an empty breakdown is absent. */
export function normalizeAgentRunTurnLatency(value: unknown): AgentRunTurnLatency | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const normalized: AgentRunTurnLatency = {};
  for (const stage of AGENT_RUN_TURN_LATENCY_STAGES) {
    const offset = source[stage];
    if (typeof offset === 'number' && Number.isFinite(offset) && offset >= 0) {
      normalized[stage] = Math.floor(offset);
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeAgentRunControlGraphPerformance(
  performance: Partial<AgentRunControlGraphPerformance> | undefined,
): AgentRunControlGraphPerformance {
  const timeToFirstTokenMs = normalizePositiveInteger(performance?.timeToFirstTokenMs);
  const turnLatency = normalizeAgentRunTurnLatency(performance?.turnLatency);

  return {
    modelTurnCount: normalizeNonNegativeInteger(performance?.modelTurnCount),
    modelDurationMs: normalizeNonNegativeInteger(performance?.modelDurationMs),
    ...(timeToFirstTokenMs ? { timeToFirstTokenMs } : {}),
    ...(turnLatency ? { turnLatency } : {}),
    toolExecutionCount: normalizeNonNegativeInteger(performance?.toolExecutionCount),
    toolExecutionDurationMs: normalizeNonNegativeInteger(performance?.toolExecutionDurationMs),
    lastCandidateToolCount: normalizeNonNegativeInteger(performance?.lastCandidateToolCount),
    lastActiveToolCount: normalizeNonNegativeInteger(performance?.lastActiveToolCount),
    maxActiveToolCount: normalizeNonNegativeInteger(performance?.maxActiveToolCount),
    lastActiveToolTokenEstimate: normalizeNonNegativeInteger(
      performance?.lastActiveToolTokenEstimate,
    ),
    maxActiveToolTokenEstimate: normalizeNonNegativeInteger(
      performance?.maxActiveToolTokenEstimate,
    ),
    updatedAt: normalizeTimestamp(performance?.updatedAt),
  };
}

function appendControlGraphAuditEvent(
  audit: ReadonlyArray<Partial<AgentRunControlGraphAuditEvent>> | undefined,
  event: AgentRunControlGraphAuditEvent,
): AgentRunControlGraphAuditEvent[] {
  return normalizeAgentRunControlGraphAuditEvents([...(audit ?? []), event]);
}

export function normalizeAgentRunControlGraphToolCallRefs(
  calls: ReadonlyArray<Partial<AgentRunControlGraphToolCallRef>> | undefined,
): AgentRunControlGraphToolCallRef[] {
  const seen = new Set<string>();
  const normalized: AgentRunControlGraphToolCallRef[] = [];

  for (const call of calls ?? []) {
    const id = normalizeOptionalText(call.id);
    const name = normalizeOptionalText(call.name);
    if (!id || !name || seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push({ id, name });
  }

  return normalized;
}

export function normalizeAgentRunControlGraphToolResultRefs(
  results: ReadonlyArray<Partial<AgentRunControlGraphToolResultRef>> | undefined,
): AgentRunControlGraphToolResultRef[] {
  const seen = new Set<string>();
  const normalized: AgentRunControlGraphToolResultRef[] = [];

  for (const result of results ?? []) {
    const id = normalizeOptionalText(result.id);
    const name = normalizeOptionalText(result.name);
    if (!id || !name || seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push({
      id,
      name,
      ...(result.failed ? { failed: true } : {}),
      ...(result.canonicalized ? { canonicalized: true } : {}),
      ...(result.graphApplied ? { graphApplied: true } : {}),
    });
  }

  return normalized;
}

export function normalizeAgentRunControlGraphAuditEvents(
  audit: ReadonlyArray<Partial<AgentRunControlGraphAuditEvent>> | undefined,
  maxEvents = MAX_AGENT_RUN_CONTROL_GRAPH_AUDIT_EVENTS,
): AgentRunControlGraphAuditEvent[] {
  return (audit ?? [])
    .map<AgentRunControlGraphAuditEvent | null>((event) => {
      const type = normalizeOptionalText(event.type);
      if (!type) {
        return null;
      }

      const iteration = normalizeNonNegativeInteger(event.iteration);
      const detail = normalizeOptionalText(event.detail);
      return {
        type,
        timestamp: normalizeTimestamp(event.timestamp),
        ...(iteration > 0 ? { iteration } : {}),
        ...(detail ? { detail } : {}),
      };
    })
    .filter((event): event is AgentRunControlGraphAuditEvent => event !== null)
    .slice(-Math.max(0, maxEvents));
}

export function normalizeAgentRunControlGraphTurnDirectives(
  directives: Partial<AgentRunControlGraphTurnDirectives> | undefined,
): AgentRunControlGraphTurnDirectives {
  const forceFinalText = directives?.forceFinalText === true;
  const forcedTextReason = normalizeForcedTextReason(directives?.forcedTextReason);
  const maxTokensOverride = normalizePositiveInteger(directives?.maxTokensOverride);
  const incompleteFinalTextContinuationPrefix = normalizeOptionalNonEmptyString(
    directives?.incompleteFinalTextContinuationPrefix,
  );
  const automaticRecoveryAttemptCount = normalizeNonNegativeInteger(
    directives?.automaticRecoveryAttemptCount,
  );
  const mobileControllerRecovery = normalizeMobileControllerRecoveryState(
    directives?.mobileControllerRecovery,
  );

  return {
    forceFinalText,
    ...(forceFinalText && forcedTextReason ? { forcedTextReason } : {}),
    requireWorkflowTool: directives?.requireWorkflowTool === true,
    ...(maxTokensOverride ? { maxTokensOverride } : {}),
    incompleteFinalTextRecoveryCount: normalizeNonNegativeInteger(
      directives?.incompleteFinalTextRecoveryCount,
    ),
    ...(incompleteFinalTextContinuationPrefix ? { incompleteFinalTextContinuationPrefix } : {}),
    ...(automaticRecoveryAttemptCount > 0 ? { automaticRecoveryAttemptCount } : {}),
    ...(mobileControllerRecovery ? { mobileControllerRecovery } : {}),
  };
}

export function normalizeAgentRunControlGraphSessionActivatedToolNames(
  toolNames: ReadonlyArray<string> | undefined,
): string[] {
  return normalizeToolNameList(toolNames);
}

export function createInitialAgentRunControlGraphState(
  state: Partial<AgentRunControlGraphState> = {},
): AgentRunControlGraphState {
  const status = CONTROL_GRAPH_STATUSES.has(state.status as AgentRunControlGraphStatus)
    ? (state.status as AgentRunControlGraphStatus)
    : 'ready';
  const finalizationHoldReason = normalizeOptionalText(state.finalizationHoldReason);
  const terminalReason = normalizeOptionalText(state.terminalReason);
  const activeTaskId = normalizeOptionalText(state.activeTaskId);
  const plan = normalizeAgentPlan(state.plan);
  const asyncWork = normalizeAgentRunControlGraphAsyncWorkState(state.asyncWork);
  const performance = normalizeAgentRunControlGraphPerformance(state.performance);
  const turnDirectives = normalizeAgentRunControlGraphTurnDirectives(state.turnDirectives);
  const sessionActivatedToolNames = normalizeAgentRunControlGraphSessionActivatedToolNames(
    state.sessionActivatedToolNames,
  );
  const requestUnderstanding = normalizeRequestUnderstandingSnapshot(state.requestUnderstanding);
  const pendingUserInput = normalizeAgentControlGraphPendingUserInput(state.pendingUserInput);

  return {
    version: AGENT_RUN_CONTROL_GRAPH_VERSION,
    status,
    iteration: normalizeNonNegativeInteger(state.iteration),
    expectedToolCalls: normalizeAgentRunControlGraphToolCallRefs(state.expectedToolCalls),
    observedToolResults: normalizeAgentRunControlGraphToolResultRefs(state.observedToolResults),
    pendingAsyncCount: normalizeNonNegativeInteger(state.pendingAsyncCount),
    lastModelToolNames: Array.from(
      new Set((state.lastModelToolNames ?? []).map(normalizeOptionalText).filter(isDefinedText)),
    ),
    ...(sessionActivatedToolNames.length > 0 ? { sessionActivatedToolNames } : {}),
    ...(finalizationHoldReason ? { finalizationHoldReason } : {}),
    ...(terminalReason ? { terminalReason } : {}),
    ...(activeTaskId ? { activeTaskId } : {}),
    ...(plan.length > 0 ? { plan } : {}),
    ...(requestUnderstanding ? { requestUnderstanding } : {}),
    ...(pendingUserInput ? { pendingUserInput } : {}),
    asyncWork,
    performance,
    turnDirectives,
    audit: normalizeAgentRunControlGraphAuditEvents(state.audit),
    updatedAt: normalizeTimestamp(state.updatedAt),
  };
}

export function normalizeAgentRunControlGraphState(
  state: Partial<AgentRunControlGraphState> | undefined,
): AgentRunControlGraphState | undefined {
  return state ? createInitialAgentRunControlGraphState(state) : undefined;
}

export function areAgentRunControlGraphStatesEqual(
  left: Partial<AgentRunControlGraphState> | undefined,
  right: Partial<AgentRunControlGraphState> | undefined,
): boolean {
  return (
    JSON.stringify(normalizeAgentRunControlGraphState(left) ?? null) ===
    JSON.stringify(normalizeAgentRunControlGraphState(right) ?? null)
  );
}

export function isAgentRunControlGraphTerminal(
  state: Partial<AgentRunControlGraphState> | undefined,
): boolean {
  const status = state?.status;
  return CONTROL_GRAPH_STATUSES.has(status as AgentRunControlGraphStatus)
    ? AGENT_RUN_CONTROL_GRAPH_TERMINAL_STATUSES.has(status as AgentRunControlGraphStatus)
    : false;
}

export function prepareAgentRunControlGraphForResume(
  state: Partial<AgentRunControlGraphState> | undefined,
  params: {
    updatedAt?: number;
    reason?: string;
  } = {},
): AgentRunControlGraphState | undefined {
  const normalized = normalizeAgentRunControlGraphState(state);
  if (!normalized) {
    return undefined;
  }

  if (
    !isAgentRunControlGraphTerminal(normalized) &&
    normalized.status !== 'awaiting_review' &&
    normalized.status !== 'awaiting_user'
  ) {
    return normalized;
  }

  const timestamp = params.updatedAt ?? Date.now();
  const previousStatus = normalized.status;
  return {
    ...normalized,
    status: 'ready',
    // A resumed run waits for nothing: the user's reply is in the transcript for the model.
    pendingUserInput: undefined,
    expectedToolCalls: [],
    observedToolResults: [],
    pendingAsyncCount: 0,
    asyncWork: normalizeAgentRunControlGraphAsyncWorkState({
      awaitingBackgroundWorkers: false,
      pendingOperations: [],
      updatedAt: timestamp,
    }),
    finalizationHoldReason: undefined,
    terminalReason: undefined,
    turnDirectives: normalizeAgentRunControlGraphTurnDirectives({
      automaticRecoveryAttemptCount: normalized.turnDirectives.automaticRecoveryAttemptCount,
    }),
    audit: appendControlGraphAuditEvent(normalized.audit, {
      type:
        previousStatus === 'awaiting_user'
          ? 'RUN_RESUMED_FROM_USER_INPUT_WAIT'
          : 'RUN_RESUMED_FROM_TERMINAL_GRAPH',
      timestamp,
      iteration: normalized.iteration,
      detail: params.reason || `resuming running agent run from ${previousStatus}`,
    }),
    updatedAt: timestamp,
  };
}

export function updateAgentRunControlGraphAsyncWorkState(
  state: Partial<AgentRunControlGraphState> | undefined,
  patch: Partial<AgentRunControlGraphAsyncWorkState> & {
    pendingOperations?: ReadonlyArray<AgentRunAsyncOperation>;
  },
): AgentRunControlGraphState {
  const base = createInitialAgentRunControlGraphState(state);
  const timestamp = patch.updatedAt ?? Date.now();
  const pendingOperations =
    patch.pendingOperations !== undefined
      ? (normalizeAgentRunAsyncOperations(patch.pendingOperations) ?? [])
      : base.asyncWork.pendingOperations;
  const asyncWork = normalizeAgentRunControlGraphAsyncWorkState({
    ...base.asyncWork,
    ...patch,
    pendingOperations,
    updatedAt: timestamp,
  });
  const pendingAsyncCount =
    patch.pendingOperations !== undefined
      ? asyncWork.pendingOperations.length
      : base.pendingAsyncCount;

  return createInitialAgentRunControlGraphState({
    ...base,
    pendingAsyncCount,
    asyncWork,
    updatedAt: timestamp,
  });
}
