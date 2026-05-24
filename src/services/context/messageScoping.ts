import type { Message } from '../../types';

/**
 * Removes a bounded count of trailing user messages used as internal control
 * prompts so request assessment/scoping logic keys off real user intent.
 */
export function excludeTrailingInternalUserMessages(
  messages: Message[],
  internalUserMessageCount: number,
): Message[] {
  const normalizedCount = Number.isFinite(internalUserMessageCount)
    ? Math.max(0, Math.floor(internalUserMessageCount))
    : 0;
  if (normalizedCount <= 0) {
    return messages;
  }

  const trimmedMessages = [...messages];
  let remainingToDrop = normalizedCount;
  for (let index = trimmedMessages.length - 1; index >= 0 && remainingToDrop > 0; index -= 1) {
    if (trimmedMessages[index].role !== 'user') {
      continue;
    }
    trimmedMessages.splice(index, 1);
    remainingToDrop -= 1;
  }

  return trimmedMessages;
}
