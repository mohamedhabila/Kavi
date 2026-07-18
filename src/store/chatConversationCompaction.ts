import type { Conversation } from '../types/conversation';
import type { Message } from '../types/message';

function isCodeOwnedCompactionSummary(message: Message): boolean {
  return (
    message.role === 'system' &&
    message.compactionProvenance?.version === 1 &&
    (message.compactionProvenance.dependency === 'transcript_only' ||
      message.compactionProvenance.dependency === 'memory_dependent')
  );
}

/** Prevent model-context repair/observation rows from becoming durable chat. */
export function selectDurableCompactionMessages(
  conversation: Pick<Conversation, 'messages'>,
  candidateMessages: Message[],
): Message[] {
  const durableMessageIds = new Set(conversation.messages.map((message) => message.id));
  return candidateMessages.filter(
    (message) => durableMessageIds.has(message.id) || isCodeOwnedCompactionSummary(message),
  );
}
