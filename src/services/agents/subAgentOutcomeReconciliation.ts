import type { Message } from '../../types/message';
import type {
  SubAgentConfig,
  SubAgentOutcomeReconciliationCode,
  SubAgentOutcomeReconciliationState,
  SubAgentSnapshot,
} from '../../types/subAgent';
import { isToolResultErrorLike } from '../../utils/toolResultErrors';
import { isExactDurableScopeId } from '../../utils/durableScopeIdentity';
import { recordAgentRunEvidenceMemory } from '../memory/agentRunEvidenceMemory';
import { isExactMemoryProvenanceId } from '../memory/memoryProvenanceIdentity';
import { canWriteLongTermMemory } from '../memory/policy';
import { sanitizeSubAgentMemorySelectionScope } from './workerMemoryBundle';

export const SUB_AGENT_OUTCOME_RECONCILIATION_MAX_ATTEMPTS = 3;

const SUMMARY_CHAR_LIMIT = 1_200;
const GOAL_CHAR_LIMIT = 1_200;
const ARTIFACT_LIMIT = 12;
const FACT_ID_LIMIT = 32;

const BLOCKED_CODES = new Set<SubAgentOutcomeReconciliationCode>([
  'memory_disabled',
  'source_scope_missing',
  'source_scope_mismatch',
  'source_context_missing',
  'invalid_identity',
  'retry_exhausted',
]);

type RecordAgentRunEvidence = typeof recordAgentRunEvidenceMemory;

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function boundedText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}\u2026`;
}

function cloneState(state: SubAgentOutcomeReconciliationState): SubAgentOutcomeReconciliationState {
  return {
    ...state,
    ...(state.factIds ? { factIds: [...state.factIds] } : {}),
  };
}

export function createPendingSubAgentOutcomeReconciliation(
  now = Date.now(),
): SubAgentOutcomeReconciliationState {
  if (!validTimestamp(now)) throw new Error('sub_agent_outcome_reconciliation_clock_invalid');
  return { status: 'pending', code: 'pending', attemptCount: 0, updatedAt: now };
}

export function sanitizeSubAgentOutcomeReconciliationState(
  value: unknown,
): SubAgentOutcomeReconciliationState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const state = value as Partial<SubAgentOutcomeReconciliationState>;
  const validStatus =
    state.status === 'pending' || state.status === 'completed' || state.status === 'blocked';
  const validCode: SubAgentOutcomeReconciliationCode[] = [
    'pending',
    'recorded_verified',
    'recorded_candidate',
    'memory_disabled',
    'source_scope_missing',
    'source_scope_mismatch',
    'source_context_missing',
    'invalid_identity',
    'write_failed',
    'retry_exhausted',
  ];
  if (
    !validStatus ||
    !validCode.includes(state.code as SubAgentOutcomeReconciliationCode) ||
    !Number.isSafeInteger(state.attemptCount) ||
    (state.attemptCount ?? -1) < 0 ||
    (state.attemptCount ?? 0) > SUB_AGENT_OUTCOME_RECONCILIATION_MAX_ATTEMPTS ||
    !validTimestamp(state.updatedAt) ||
    (state.completedAt !== undefined && !validTimestamp(state.completedAt)) ||
    (state.status === 'completed' && state.completedAt === undefined) ||
    (state.status !== 'completed' && state.completedAt !== undefined) ||
    (state.status === 'pending' &&
      ((state.code === 'pending' && state.attemptCount !== 0) ||
        (state.code === 'write_failed' &&
          ((state.attemptCount ?? 0) < 1 ||
            (state.attemptCount ?? 0) >= SUB_AGENT_OUTCOME_RECONCILIATION_MAX_ATTEMPTS)) ||
        (state.code !== 'pending' && state.code !== 'write_failed'))) ||
    (state.status === 'completed' &&
      (state.attemptCount === 0 ||
        (state.code !== 'recorded_verified' && state.code !== 'recorded_candidate') ||
        !Array.isArray(state.factIds) ||
        state.factIds.length === 0)) ||
    (state.status === 'blocked' &&
      (state.attemptCount === 0 ||
        !BLOCKED_CODES.has(state.code as SubAgentOutcomeReconciliationCode))) ||
    (state.status !== 'completed' && state.factIds !== undefined) ||
    (state.factIds !== undefined &&
      (!Array.isArray(state.factIds) ||
        state.factIds.length > FACT_ID_LIMIT ||
        !state.factIds.every(isExactMemoryProvenanceId) ||
        new Set(state.factIds).size !== state.factIds.length))
  ) {
    return undefined;
  }
  return cloneState(state as SubAgentOutcomeReconciliationState);
}

function terminalState(
  status: 'completed' | 'blocked',
  code: SubAgentOutcomeReconciliationCode,
  attemptCount: number,
  now: number,
  factIds?: string[],
): SubAgentOutcomeReconciliationState {
  return {
    status,
    code,
    attemptCount,
    updatedAt: now,
    ...(status === 'completed' ? { completedAt: now } : {}),
    ...(factIds?.length ? { factIds: [...new Set(factIds)].sort().slice(0, FACT_ID_LIMIT) } : {}),
  };
}

function retryState(attemptCount: number, now: number): SubAgentOutcomeReconciliationState {
  if (attemptCount >= SUB_AGENT_OUTCOME_RECONCILIATION_MAX_ATTEMPTS) {
    return terminalState('blocked', 'retry_exhausted', attemptCount, now);
  }
  return { status: 'pending', code: 'write_failed', attemptCount, updatedAt: now };
}

function hasObservedSuccessfulToolResult(messages: ReadonlyArray<Message>): boolean {
  return messages.some((message) =>
    (message.toolCalls ?? []).some(
      (toolCall) =>
        toolCall.status === 'completed' &&
        typeof toolCall.result === 'string' &&
        toolCall.result.trim().length > 0 &&
        !isToolResultErrorLike(toolCall.result),
    ),
  );
}

function sourceTurnIdentity(
  messages: ReadonlyArray<Message>,
): { id: string; timestamp: number } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message?.role === 'assistant' &&
      isExactMemoryProvenanceId(message.id) &&
      validTimestamp(message.timestamp)
    ) {
      return { id: message.id, timestamp: message.timestamp };
    }
  }
  return null;
}

function artifactPaths(agent: SubAgentSnapshot): string[] {
  return Array.from(
    new Set(
      (agent.artifacts ?? [])
        .map((artifact) => boundedText(artifact.workspacePath, 500))
        .filter((path): path is string => Boolean(path)),
    ),
  )
    .sort()
    .slice(0, ARTIFACT_LIMIT);
}

function reconciliationEvidence(input: {
  agent: SubAgentSnapshot;
  config: SubAgentConfig;
  observedToolResult: boolean;
}): string[] {
  const verified =
    input.agent.status === 'completed' &&
    input.agent.completionState === 'verified_success' &&
    input.observedToolResult;
  const status = verified
    ? 'completed'
    : input.agent.status === 'completed'
      ? 'incomplete'
      : input.agent.status;
  const summary = boundedText(input.agent.output, SUMMARY_CHAR_LIMIT);
  const base = {
    sourceRunId: input.agent.sessionId,
    parentRunId: input.agent.agentRunId,
    actorId: input.agent.sessionId,
    actorType: 'worker',
    goal: boundedText(input.config.prompt, GOAL_CHAR_LIMIT),
    status,
    outcome: verified ? 'verified_success' : (input.agent.completionState ?? status),
    completionState: input.agent.completionState,
    observedToolResult: input.observedToolResult,
    summary,
    ...(!verified
      ? {
          risk:
            input.agent.status === 'completed'
              ? 'Worker report lacked independently observed successful tool evidence.'
              : `Worker terminal status: ${input.agent.status}.`,
        }
      : {}),
  };
  return [
    JSON.stringify(base),
    ...artifactPaths(input.agent).map((artifact) =>
      JSON.stringify({
        sourceRunId: input.agent.sessionId,
        parentRunId: input.agent.agentRunId,
        actorId: input.agent.sessionId,
        actorType: 'worker',
        status,
        artifact,
      }),
    ),
  ];
}

function identitiesAreValid(agent: SubAgentSnapshot, config: SubAgentConfig): boolean {
  return (
    isExactMemoryProvenanceId(agent.sessionId) &&
    isExactDurableScopeId(agent.parentConversationId) &&
    (agent.agentRunId === undefined || isExactMemoryProvenanceId(agent.agentRunId)) &&
    (agent.workstreamId === undefined || isExactDurableScopeId(agent.workstreamId)) &&
    typeof config.prompt === 'string' &&
    config.prompt.trim().length > 0
  );
}

export async function reconcileSubAgentOutcomeMemory(input: {
  agent: SubAgentSnapshot;
  config?: SubAgentConfig;
  messages?: ReadonlyArray<Message>;
  now?: number;
  recordEvidence?: RecordAgentRunEvidence;
}): Promise<SubAgentOutcomeReconciliationState> {
  const now = input.now ?? Date.now();
  if (!validTimestamp(now)) throw new Error('sub_agent_outcome_reconciliation_clock_invalid');
  const existing = sanitizeSubAgentOutcomeReconciliationState(input.agent.outcomeReconciliation);
  if (existing && existing.status !== 'pending') return existing;
  const attemptCount = (existing?.attemptCount ?? 0) + 1;

  if (!input.config || !Array.isArray(input.messages)) {
    return terminalState('blocked', 'source_context_missing', attemptCount, now);
  }
  if (!identitiesAreValid(input.agent, input.config) || input.agent.status === 'running') {
    return terminalState('blocked', 'invalid_identity', attemptCount, now);
  }
  const scope = sanitizeSubAgentMemorySelectionScope(input.config.memorySelectionScope);
  if (!scope) return terminalState('blocked', 'source_scope_missing', attemptCount, now);
  if (
    scope.sourceThreadId !== input.agent.parentConversationId ||
    scope.taskId !== (input.agent.workstreamId ?? null) ||
    scope.taskId !== (input.config.workstreamId ?? null)
  ) {
    return terminalState('blocked', 'source_scope_mismatch', attemptCount, now);
  }
  if (!canWriteLongTermMemory()) {
    return terminalState('blocked', 'memory_disabled', attemptCount, now);
  }

  const observedToolResult = hasObservedSuccessfulToolResult(input.messages);
  const sourceTurn = sourceTurnIdentity(input.messages);
  if (!sourceTurn) {
    return terminalState('blocked', 'source_context_missing', attemptCount, now);
  }
  const verified =
    input.agent.status === 'completed' &&
    input.agent.completionState === 'verified_success' &&
    observedToolResult;
  try {
    const result = (input.recordEvidence ?? recordAgentRunEvidenceMemory)({
      messages: input.messages,
      evidence: reconciliationEvidence({
        agent: input.agent,
        config: input.config,
        observedToolResult,
      }),
      conversationId: scope.memoryConversationId,
      threadId: scope.sourceThreadId,
      taskId: scope.taskId,
      sourceRunId: input.agent.sessionId,
      sourceActorId: input.agent.sessionId,
      ...(input.agent.agentRunId ? { parentRunId: input.agent.agentRunId } : {}),
      sourceTurnId: sourceTurn.id,
      now: sourceTurn.timestamp,
    });
    if (result.factIds.length === 0) return retryState(attemptCount, now);
    return terminalState(
      'completed',
      verified ? 'recorded_verified' : 'recorded_candidate',
      attemptCount,
      now,
      result.factIds,
    );
  } catch {
    return retryState(attemptCount, now);
  }
}
