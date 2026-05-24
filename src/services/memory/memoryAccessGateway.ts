import type { Message } from '../../types';
import {
  selectContextStartIndex,
  type ContextStartSelection,
} from '../context/contextStartSelector';
import { excludeTrailingInternalUserMessages } from '../context/messageScoping';
import {
  buildLivingMemorySections,
  type LivingMemoryBridgeOutput,
} from './livingMemoryBridge';
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

  const boundary = selectContextStartIndex(normalizedMessages, {
    personaId: request.personaId,
    mode: request.mode,
    ...(typeof request.now === 'number' ? { now: request.now } : {}),
  });

  const scopedMessages =
    boundary.startIndex > 0
      ? normalizedMessages.slice(boundary.startIndex)
      : normalizedMessages;

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
  });

  return {
    boundary,
    scopedMessages,
    livingMemory,
  };
}
