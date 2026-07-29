import type { AgentGoal } from '../../engine/goals/types';
import type { AgentRunControlGraphAsyncWorkState } from '../../types/agentRun';
import type { Message } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import {
  buildFullHistoryContextStartSelection,
  selectContextStartIndex,
  type ContextStartSelection,
} from '../context/contextStartSelector';
import { excludeTrailingInternalUserMessages } from '../context/messageScoping';
import { buildLivingMemorySections, type LivingMemoryBridgeOutput } from './livingMemoryBridge';
import {
  waitForNextTurnMemoryConsistency,
  type NextTurnMemoryConsistencyResult,
} from './nextTurnConsistency';
import { findLastClosedTurn } from './closedTurn';
import {
  resolveMemoryContextStrategy,
  resolveMemoryRetrievalStrategy,
  type MemoryContextStrategy,
  type MemoryRetrievalStrategy,
} from './memoryAccessPolicy';
import { createCurrentLocalSimilarityVector } from './localSimilarity';
import { buildRecentUserRetrievalQuery } from './retrievalQueryText';
import { maintainCurrentFactLocalSimilarity } from './localSimilarityBackfill';
import { captureMemoryReadEpoch, isMemoryReadEpochCurrent } from './policy';
import {
  captureMemoryAuthoritySnapshot,
  isMemoryProjectionSnapshotCurrent,
  isMemoryProjectionSnapshotDurablyCurrent,
  type MemoryAuthoritySnapshot,
} from './memoryAuthority';

type MemoryAccessMode = 'chat' | 'agentic' | 'pilot';

export interface UnifiedMemoryAccessRequest {
  messages: Message[];
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string | null;
  personaId: string;
  mode: MemoryAccessMode;
  internalUserMessageCount?: number;
  now?: number;
  recallLimit?: number;
  goals?: ReadonlyArray<AgentGoal>;
  activeTaskId?: string;
  asyncWork?: AgentRunControlGraphAsyncWorkState;
  retrievalLlm?: {
    provider: LlmProviderConfig;
    model?: string;
  };
  retrievalStrategy?: MemoryRetrievalStrategy;
  contextStrategy?: MemoryContextStrategy;
}

export interface UnifiedMemoryAccessResult {
  boundary: ContextStartSelection;
  scopedMessages: Message[];
  livingMemory: LivingMemoryBridgeOutput | null;
  consistencyBarrier: NextTurnMemoryConsistencyResult;
}

function isAuthorizedMemoryAuthorityContinuation(
  initial: MemoryAuthoritySnapshot,
  continuation: MemoryAuthoritySnapshot,
): boolean {
  return (
    continuation.restrictiveRevision.memoryOwnerId === initial.restrictiveRevision.memoryOwnerId &&
    continuation.restrictiveRevision.value === initial.restrictiveRevision.value &&
    continuation.policy.enabled === true &&
    continuation.policy.revision === initial.policy.revision &&
    continuation.processEpochs.restrictive === initial.processEpochs.restrictive &&
    continuation.projectionRevision.memoryOwnerId === initial.projectionRevision.memoryOwnerId &&
    continuation.projectionRevision.value >= initial.projectionRevision.value
  );
}

export async function buildUnifiedMemoryAccessContext(
  request: UnifiedMemoryAccessRequest,
): Promise<UnifiedMemoryAccessResult> {
  const normalizedMessages = excludeTrailingInternalUserMessages(
    request.messages,
    request.internalUserMessageCount ?? 0,
  );
  const retrievalStrategy = resolveMemoryRetrievalStrategy(request.retrievalStrategy);
  const contextStrategy = resolveMemoryContextStrategy(request.contextStrategy);
  const personaId = request.personaId;

  const boundary =
    request.mode === 'pilot' && contextStrategy === 'production'
      ? selectContextStartIndex(normalizedMessages, {
          personaId,
          mode: request.mode,
          ...(typeof request.now === 'number' ? { now: request.now } : {}),
        })
      : buildFullHistoryContextStartSelection(normalizedMessages);

  const scopedMessages =
    boundary.startIndex > 0 ? normalizedMessages.slice(boundary.startIndex) : normalizedMessages;
  const precedingClosedTurn = findLastClosedTurn(normalizedMessages);
  const memoryReadEpoch = captureMemoryReadEpoch();
  const consistencyBarrier = await waitForNextTurnMemoryConsistency({
    memoryConversationId: request.memoryConversationId,
    sourceThreadId: request.sourceThreadId,
    sourceEndMessageId: precedingClosedTurn.assistant?.id ?? null,
    ...(memoryReadEpoch !== null ? { memoryReadEpoch } : {}),
  });

  const optOutResult = (): UnifiedMemoryAccessResult => ({
    boundary,
    scopedMessages,
    livingMemory: null,
    consistencyBarrier: { ...consistencyBarrier, outcome: 'opt_out' },
  });
  const unavailableResult = (): UnifiedMemoryAccessResult => ({
    boundary,
    scopedMessages,
    livingMemory: null,
    consistencyBarrier,
  });
  if (
    memoryReadEpoch === null ||
    consistencyBarrier.outcome === 'opt_out' ||
    !isMemoryReadEpochCurrent(memoryReadEpoch)
  ) {
    return optOutResult();
  }

  if (retrievalStrategy === 'production') {
    maintainCurrentFactLocalSimilarity({
      ...(typeof request.now === 'number' ? { now: request.now } : {}),
    });
  }

  const memoryAuthoritySnapshot = captureMemoryAuthoritySnapshot();
  if (!memoryAuthoritySnapshot) return unavailableResult();

  const localSimilarityQuery = buildRecentUserRetrievalQuery(scopedMessages);
  const localSimilarity =
    retrievalStrategy === 'production' && localSimilarityQuery
      ? { queryVector: createCurrentLocalSimilarityVector(localSimilarityQuery) }
      : undefined;

  const livingMemoryResult = await buildLivingMemorySections({
    messages: scopedMessages,
    ...(typeof request.now === 'number' ? { now: request.now } : {}),
    ...(typeof request.recallLimit === 'number' ? { recallLimit: request.recallLimit } : {}),
    conversationId: request.memoryConversationId,
    sourceThreadId: request.sourceThreadId,
    personaId,
    taskId: request.taskId,
    candidateStrategy: retrievalStrategy === 'lexical_only' ? 'lexical' : 'hybrid',
    ...(localSimilarity ? { localSimilarity } : {}),
    consistencyBarrier,
    ...(request.goals ? { goals: request.goals } : {}),
    ...(request.activeTaskId ? { activeTaskId: request.activeTaskId } : {}),
    ...(request.asyncWork ? { asyncWork: request.asyncWork } : {}),
    ...(retrievalStrategy === 'production' && request.retrievalLlm
      ? { retrievalLlm: request.retrievalLlm }
      : {}),
    memoryReadEpoch,
    memoryAuthoritySnapshot,
  });
  if (!isMemoryReadEpochCurrent(memoryReadEpoch)) return optOutResult();
  const continuedMemoryAuthoritySnapshot = livingMemoryResult.memoryAuthoritySnapshot;
  if (
    !continuedMemoryAuthoritySnapshot ||
    !isAuthorizedMemoryAuthorityContinuation(
      memoryAuthoritySnapshot,
      continuedMemoryAuthoritySnapshot,
    ) ||
    !isMemoryProjectionSnapshotCurrent(continuedMemoryAuthoritySnapshot) ||
    !isMemoryProjectionSnapshotDurablyCurrent(continuedMemoryAuthoritySnapshot)
  ) {
    return unavailableResult();
  }
  const livingMemory: LivingMemoryBridgeOutput = {
    ...livingMemoryResult,
    memoryReadEpoch,
    memoryAuthoritySnapshot: continuedMemoryAuthoritySnapshot,
    consistencyBarrier,
  };

  return {
    boundary,
    scopedMessages,
    livingMemory,
    consistencyBarrier,
  };
}
