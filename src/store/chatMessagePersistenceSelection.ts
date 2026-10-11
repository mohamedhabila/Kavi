import type { Message } from '../types/message';

/**
 * The messages a conversation keeps when it holds more than `maxMessages`: the first one,
 * the protected ones (execution ownership), then the newest that fit. Selection is stable
 * and duplicate-free; evicted messages go to the transcript archive.
 */
export function selectMessagesForPersistence(
  messages: readonly Message[],
  maxMessages: number,
  protectedMessageIds: ReadonlySet<string> = new Set(),
): Message[] {
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 1) {
    throw new Error('chat_message_persistence_limit_invalid');
  }
  if (messages.length === 0) return [];

  const selectedIndices = new Set<number>([0]);
  for (let index = 0; index < messages.length; index += 1) {
    if (protectedMessageIds.has(messages[index]!.id)) selectedIndices.add(index);
  }
  if (selectedIndices.size > maxMessages) {
    throw new Error('chat_message_persistence_protected_messages_exceed_limit');
  }
  for (
    let index = messages.length - 1;
    index >= 0 && selectedIndices.size < maxMessages;
    index -= 1
  ) {
    selectedIndices.add(index);
  }
  return messages.filter((_message, index) => selectedIndices.has(index));
}
