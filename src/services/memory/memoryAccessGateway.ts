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
import { findLastClosedTurn } from './turnProcessor';
import {
  resolveMemoryContextStrategy,
  resolveMemoryRetrievalStrategy,
  type MemoryContextStrategy,
  type MemoryRetrievalStrategy,
} from './memoryAccessPolicy';

type MemoryAccessMode = 'chat' | 'agentic' | 'pilot';

export interface UnifiedMemoryAccessRequest {
  messages: Message[];
  memoryConversationId: string;
  sourceThreadId: string;
  taskId?: string;
  personaId?: string;
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

export async function buildUnifiedMemoryAccessContext(
  request: UnifiedMemoryAccessRequest,
): Promise<UnifiedMemoryAccessResult> {
  const normalizedMessages = excludeTrailingInternalUserMessages(
    request.messages,
    request.internalUserMessageCount ?? 0,
  );
  const retrievalStrategy = resolveMemoryRetrievalStrategy(request.retrievalStrategy);
  const contextStrategy = resolveMemoryContextStrategy(request.contextStrategy);

  const boundary =
    request.mode === 'pilot' && contextStrategy === 'production'
      ? selectContextStartIndex(normalizedMessages, {
          personaId: request.personaId,
          mode: request.mode,
          ...(typeof request.now === 'number' ? { now: request.now } : {}),
        })
      : buildFullHistoryContextStartSelection(normalizedMessages);

  const scopedMessages =
    boundary.startIndex > 0 ? normalizedMessages.slice(boundary.startIndex) : normalizedMessages;
  const precedingClosedTurn = findLastClosedTurn(normalizedMessages);
  const consistencyBarrier = await waitForNextTurnMemoryConsistency({
    memoryConversationId: request.memoryConversationId,
    sourceThreadId: request.sourceThreadId,
    sourceEndMessageId: precedingClosedTurn.assistant?.id ?? null,
  });

  if (consistencyBarrier.outcome === 'opt_out') {
    return {
      boundary,
      scopedMessages,
      livingMemory: null,
      consistencyBarrier,
    };
  }

  const livingMemoryResult = await buildLivingMemorySections({
    messages: scopedMessages,
    ...(typeof request.now === 'number' ? { now: request.now } : {}),
    ...(typeof request.recallLimit === 'number' ? { recallLimit: request.recallLimit } : {}),
    conversationId: request.memoryConversationId,
    sourceThreadId: request.sourceThreadId,
    consistencyBarrier,
    ...(request.taskId ? { taskId: request.taskId } : {}),
    ...(request.goals ? { goals: request.goals } : {}),
    ...(request.activeTaskId ? { activeTaskId: request.activeTaskId } : {}),
    ...(request.asyncWork ? { asyncWork: request.asyncWork } : {}),
    ...(retrievalStrategy === 'production' && request.retrievalLlm
      ? { retrievalLlm: request.retrievalLlm }
      : {}),
  });
  const livingMemory: LivingMemoryBridgeOutput = {
    ...livingMemoryResult,
    consistencyBarrier,
  };

  return {
    boundary,
    scopedMessages,
    livingMemory,
    consistencyBarrier,
  };
}
