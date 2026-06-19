import type { AgentGoal } from '../../engine/goals/types';
import type { AgentRunControlGraphAsyncWorkState } from '../../types/agentRun';
import type { Message } from '../../types/message';
import {
  buildFullHistoryContextStartSelection,
  selectContextStartIndex,
  type ContextStartSelection,
} from '../context/contextStartSelector';
import { excludeTrailingInternalUserMessages } from '../context/messageScoping';
import { buildLivingMemorySections, type LivingMemoryBridgeOutput } from './livingMemoryBridge';
import { canReadLongTermMemory } from './policy';

type MemoryAccessMode = 'chat' | 'agentic' | 'pilot';

export interface UnifiedMemoryAccessRequest {
  messages: Message[];
  conversationId?: string;
  taskId?: string;
  personaId?: string;
  mode: MemoryAccessMode;
  internalUserMessageCount?: number;
  now?: number;
  recallLimit?: number;
  goals?: ReadonlyArray<AgentGoal>;
  activeTaskId?: string;
  asyncWork?: AgentRunControlGraphAsyncWorkState;
}

export interface UnifiedMemoryAccessResult {
  boundary: ContextStartSelection;
  scopedMessages: Message[];
  livingMemory: LivingMemoryBridgeOutput | null;
}

export async function buildUnifiedMemoryAccessContext(
  request: UnifiedMemoryAccessRequest,
): Promise<UnifiedMemoryAccessResult> {
  const normalizedMessages = excludeTrailingInternalUserMessages(
    request.messages,
    request.internalUserMessageCount ?? 0,
  );

  const boundary =
    request.mode === 'pilot'
      ? selectContextStartIndex(normalizedMessages, {
          personaId: request.personaId,
          mode: request.mode,
          ...(typeof request.now === 'number' ? { now: request.now } : {}),
        })
      : buildFullHistoryContextStartSelection(normalizedMessages);

  const scopedMessages =
    boundary.startIndex > 0 ? normalizedMessages.slice(boundary.startIndex) : normalizedMessages;

  if (!canReadLongTermMemory()) {
    return {
      boundary,
      scopedMessages,
      livingMemory: null,
    };
  }

  const livingMemory = await buildLivingMemorySections({
    messages: scopedMessages,
    ...(typeof request.now === 'number' ? { now: request.now } : {}),
    ...(typeof request.recallLimit === 'number' ? { recallLimit: request.recallLimit } : {}),
    ...(request.conversationId ? { conversationId: request.conversationId } : {}),
    ...(request.taskId ? { taskId: request.taskId } : {}),
    ...(request.goals ? { goals: request.goals } : {}),
    ...(request.activeTaskId ? { activeTaskId: request.activeTaskId } : {}),
    ...(request.asyncWork ? { asyncWork: request.asyncWork } : {}),
  });

  return {
    boundary,
    scopedMessages,
    livingMemory,
  };
}
