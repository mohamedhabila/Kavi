import type { Message } from '../types/message';
import { excludeTrailingInternalUserMessages } from '../services/context/messageScoping';
import { buildFullHistoryContextStartSelection } from '../services/context/contextStartSelector';

export function buildScopedFallbackMemoryAccessContext(options: {
  messages: Message[];
  personaId?: string;
  mode: 'chat' | 'agentic';
  internalUserMessageCount: number;
}): {
  boundary: {
    startIndex: number;
    reason: 'full_history' | 'single_user_turn' | 'topic_shift_boundary' | 'carryover_limit';
    similarityScore: number;
    idleGapMs: number;
    droppedMessageCount: number;
  };
  scopedMessages: Message[];
  livingMemory: null;
} {
  const normalizedMessages = excludeTrailingInternalUserMessages(
    options.messages,
    options.internalUserMessageCount,
  );
  const boundary = buildFullHistoryContextStartSelection(normalizedMessages);
  const scopedMessages =
    boundary.startIndex > 0 ? normalizedMessages.slice(boundary.startIndex) : normalizedMessages;

  return {
    boundary,
    scopedMessages,
    livingMemory: null,
  };
}
