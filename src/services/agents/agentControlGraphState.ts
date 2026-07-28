import type {
  AgentGoal,
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
} from '../../types/agentRun';
import {
  normalizeGoalCompletionPolicy,
  resolveDefaultGoalCompletionPolicy,
} from '../../engine/goals/types';
import {
  MAX_AGENT_GOAL_USER_CONSTRAINTS,
  readPersistedAgentGoalUserConstraintState,
} from '../../engine/goals/userConstraints';
import { normalizeToolNameList } from '../../engine/tools/toolNameNormalization';
import {
  normalizeAgentRunControlGraphAsyncWorkState,
  normalizeAgentRunAsyncOperations,
} from './agentRunAsyncState';
import { normalizeRequestUnderstandingSnapshot } from './requestUnderstandingProjection';
import {
  admitAgentControlGraphClarificationReply,
  normalizeAgentControlGraphPendingUserInput,
} from './agentControlGraphClarificationState';

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

const FORCED_TEXT_REASONS = new Set<AgentRunControlGraphForcedTextReason>([
  'async_terminal_completion',
  'background_session_started',
  'empty_delivery_recovery',
  'execution_loop_recovery',
  'incomplete_delivery_continuation',
  'loop_recovery',
  'persistent_context_settled',
  'request_clarification',
  'request_consent',
  'request_decline',
  'request_wait',
  'workflow_route_completed',
  'yield_finalization',
]);

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
  return FORCED_TEXT_REASONS.has(value as AgentRunControlGraphForcedTextReason)
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
  if (!value || value.version !== 1 || !TOOL_EFFECT_DIGEST_PATTERN.test(value.strategyFingerprint)) {
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
    return { version: 1, phase: value.phase, strategyFingerprint, consecutiveStallCount, toolCallId };
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

export function normalizeAgentRunControlGraphPerformance(
  performance: Partial<AgentRunControlGraphPerformance> | undefined,
): AgentRunControlGraphPerformance {
  const timeToFirstTokenMs = normalizePositiveInteger(performance?.timeToFirstTokenMs);

  return {
    modelTurnCount: normalizeNonNegativeInteger(performance?.modelTurnCount),
    modelDurationMs: normalizeNonNegativeInteger(performance?.modelDurationMs),
    ...(timeToFirstTokenMs ? { timeToFirstTokenMs } : {}),
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
    const evidence = Array.isArray(result.evidence)
      ? Array.from(
          new Set(
            result.evidence.filter(
              (entry: unknown): entry is string =>
                typeof entry === 'string' && entry.trim().length > 0,
            ),
          ),
        )
      : [];
    normalized.push({
      id,
      name,
      ...(result.failed ? { failed: true } : {}),
      ...(result.canonicalized ? { canonicalized: true } : {}),
      ...(result.graphApplied ? { graphApplied: true } : {}),
      ...(evidence.length > 0 ? { evidence } : {}),
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

export function normalizeAgentRunControlGraphGoals(
  goals: ReadonlyArray<Partial<AgentGoal>> | undefined,
): AgentGoal[] {
  if (!Array.isArray(goals)) return [];

  const seen = new Set<string>();
  const normalized: AgentGoal[] = [];
  const constraintLineageEntries: Array<{
    goalId: string;
    constraints: Array<{ text: string; sourceMessageId: string }>;
  }> = [];

  for (const g of goals) {
    if (!g || typeof g !== 'object') continue;
    const id = typeof g.id === 'string' && g.id.trim().length > 0 ? g.id.trim() : '';
    const title = typeof g.title === 'string' && g.title.trim().length > 0 ? g.title.trim() : '';
    if (!title) continue;
    const finalId =
      id || `goal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    if (seen.has(finalId)) continue;
    seen.add(finalId);

    const status =
      g.status === 'pending' ||
      g.status === 'active' ||
      g.status === 'completed' ||
      g.status === 'blocked'
        ? g.status
        : 'pending';

    const dependencies = Array.isArray(g.dependencies)
      ? g.dependencies.filter(
          (d: unknown): d is string => typeof d === 'string' && d.trim().length > 0,
        )
      : [];

    const evidence = Array.isArray(g.evidence)
      ? g.evidence.filter((e: unknown): e is string => typeof e === 'string' && e.trim().length > 0)
      : [];

    const requiredCapabilities = Array.isArray(g.requiredCapabilities)
      ? g.requiredCapabilities.filter(
          (c: unknown): c is string => typeof c === 'string' && c.trim().length > 0,
        )
      : undefined;

    const requiredResourceKinds = Array.isArray(g.requiredResourceKinds)
      ? g.requiredResourceKinds.filter(
          (r: unknown): r is string => typeof r === 'string' && r.trim().length > 0,
        )
      : undefined;

    const successCriteria = Array.isArray(g.successCriteria)
      ? g.successCriteria.filter(
          (c: unknown): c is string => typeof c === 'string' && c.trim().length > 0,
        )
      : undefined;

    const completionPolicy =
      normalizeGoalCompletionPolicy(g.completionPolicy) ??
      resolveDefaultGoalCompletionPolicy({ successCriteria });
    const userConstraintState =
      g.userConstraintIntegrity !== undefined
        ? ({ state: 'conflict' } as const)
        : readPersistedAgentGoalUserConstraintState({
            value: g.userConstraints,
            allowedOnGoal: completionPolicy === 'blocking',
          });

    const blockedReason =
      typeof g.blockedReason === 'string' && g.blockedReason.trim().length > 0
        ? g.blockedReason.trim()
        : undefined;

    const owner = g.owner === 'supervisor' || typeof g.owner === 'string' ? g.owner : undefined;
    const createdAt =
      typeof g.createdAt === 'number' && Number.isFinite(g.createdAt) ? g.createdAt : Date.now();
    const updatedAt =
      typeof g.updatedAt === 'number' && Number.isFinite(g.updatedAt) ? g.updatedAt : createdAt;
    const completedAt =
      status === 'completed' && typeof g.completedAt === 'number' && Number.isFinite(g.completedAt)
        ? g.completedAt
        : undefined;
    const hasCanonicalUserConstraints =
      userConstraintState.state === 'canonical' && userConstraintState.constraints.length > 0;
    const hasCompletedConstraintObligation =
      status === 'completed' &&
      (hasCanonicalUserConstraints ||
        userConstraintState.state === 'conflict' ||
        g.userConstraintDeliveryPending === true);
    const hasCanonicalPendingConstraintDelivery =
      status === 'completed' &&
      g.userConstraintDeliveryPending === true &&
      hasCanonicalUserConstraints;
    const hasUserConstraintConflict =
      userConstraintState.state === 'conflict' ||
      (hasCompletedConstraintObligation && !hasCanonicalPendingConstraintDelivery);
    if (userConstraintState.state === 'canonical') {
      constraintLineageEntries.push({
        goalId: finalId,
        constraints: userConstraintState.constraints,
      });
    }

    normalized.push({
      id: finalId,
      title,
      ...(typeof g.description === 'string' && g.description.trim().length > 0
        ? { description: g.description.trim() }
        : {}),
      status,
      dependencies: Array.from(new Set(dependencies)),
      evidence: Array.from(new Set(evidence)),
      createdAt,
      updatedAt,
      ...(completedAt ? { completedAt } : {}),
      ...(owner ? { owner } : {}),
      ...(requiredCapabilities?.length ? { requiredCapabilities } : {}),
      ...(requiredResourceKinds?.length ? { requiredResourceKinds } : {}),
      ...(successCriteria?.length ? { successCriteria } : {}),
      ...(userConstraintState.state === 'canonical' && !hasUserConstraintConflict
        ? { userConstraints: userConstraintState.constraints }
        : {}),
      ...(hasUserConstraintConflict
        ? { userConstraintIntegrity: 'conflict' as const }
        : {}),
      ...(hasCompletedConstraintObligation
        ? { userConstraintDeliveryPending: true as const }
        : {}),
      completionPolicy,
      ...(blockedReason ? { blockedReason } : {}),
    });
  }

  const constraintBearingGoals = normalized.filter(
    (goal) =>
      (goal.status === 'active' ||
        goal.status === 'blocked' ||
        goal.status === 'pending' ||
        goal.userConstraintDeliveryPending === true) &&
      (goal.userConstraints?.length ?? 0) > 0,
  );
  const retainedStatementCount = constraintBearingGoals.reduce(
    (count, goal) => count + (goal.userConstraints?.length ?? 0),
    0,
  );
  const conflictingGoalIds = new Set(
    normalized
      .filter((goal) => goal.userConstraintIntegrity === 'conflict')
      .map((goal) => goal.id),
  );
  if (retainedStatementCount > MAX_AGENT_GOAL_USER_CONSTRAINTS) {
    for (const goal of constraintBearingGoals) conflictingGoalIds.add(goal.id);
  }
  const sourceLineage = new Map<string, { texts: Set<string>; goalIds: Set<string> }>();
  for (const entry of constraintLineageEntries) {
    for (const constraint of entry.constraints) {
      const existing = sourceLineage.get(constraint.sourceMessageId);
      if (!existing) {
        sourceLineage.set(constraint.sourceMessageId, {
          texts: new Set([constraint.text]),
          goalIds: new Set([entry.goalId]),
        });
        continue;
      }
      existing.goalIds.add(entry.goalId);
      existing.texts.add(constraint.text);
    }
  }
  for (const lineage of sourceLineage.values()) {
    if (lineage.texts.size <= 1) continue;
    for (const goalId of lineage.goalIds) conflictingGoalIds.add(goalId);
  }
  if (conflictingGoalIds.size === 0) return normalized;
  return normalized.map((goal) => {
    if (!conflictingGoalIds.has(goal.id)) return goal;
    const conflicted = { ...goal, userConstraintIntegrity: 'conflict' as const };
    delete conflicted.userConstraints;
    return conflicted;
  });
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
  const goals = normalizeAgentRunControlGraphGoals(state.goals);
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
    ...(goals.length > 0 ? { goals } : {}),
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
    resolvedUserInformationKeys?: ReadonlyArray<string>;
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
  const clearsPendingDelivery = previousStatus === 'cancelled';
  const pendingUserInput = admitAgentControlGraphClarificationReply({
    pendingUserInput: normalized.pendingUserInput,
    resolvedUserInformationKeys: params.resolvedUserInformationKeys,
    updatedAt: timestamp,
  });
  return {
    ...normalized,
    goals: clearsPendingDelivery
      ? normalized.goals?.map((goal) => {
          const next = { ...goal };
          delete next.userConstraintDeliveryPending;
          delete next.userConstraints;
          delete next.userConstraintIntegrity;
          return next;
        })
      : normalized.goals,
    status: 'ready',
    pendingUserInput,
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
      automaticRecoveryAttemptCount:
        normalized.turnDirectives.automaticRecoveryAttemptCount,
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
