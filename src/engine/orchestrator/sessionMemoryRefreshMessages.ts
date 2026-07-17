import type { Message } from '../../types/message';

function assertUniqueMessageIds(messages: ReadonlyArray<Message>, reason: string): void {
  const ids = new Set<string>();
  for (const message of messages) {
    const id = message.id.trim();
    if (!id || ids.has(id)) throw new Error(reason);
    ids.add(id);
  }
}

export function captureSessionInternalUserMessages(
  messages: ReadonlyArray<Message>,
  internalUserMessageCount: number,
): ReadonlyArray<Message> {
  const normalizedCount = Number.isFinite(internalUserMessageCount)
    ? Math.max(0, Math.floor(internalUserMessageCount))
    : 0;
  if (normalizedCount === 0) return Object.freeze([]);
  assertUniqueMessageIds(messages, 'internal_user_message_identity_ambiguous');

  const selected: Message[] = [];
  for (
    let index = messages.length - 1;
    index >= 0 && selected.length < normalizedCount;
    index -= 1
  ) {
    const message = messages[index];
    if (message.role === 'user') selected.push(message);
  }
  if (selected.length !== normalizedCount) {
    throw new Error('internal_user_message_count_mismatch');
  }
  selected.reverse();
  return Object.freeze(selected.map((message) => Object.freeze({ ...message })));
}

function messagesMatch(left: Message, right: Message): boolean {
  return (
    left.id === right.id &&
    left.role === right.role &&
    left.content === right.content &&
    left.enrichedContent === right.enrichedContent &&
    left.timestamp === right.timestamp &&
    JSON.stringify(left.attachments ?? []) === JSON.stringify(right.attachments ?? [])
  );
}

export function rebuildSessionMemoryRefreshMessages(params: {
  internalUserMessages: ReadonlyArray<Message>;
  workingMessages: ReadonlyArray<Message>;
}): Message[] {
  assertUniqueMessageIds(params.internalUserMessages, 'internal_user_message_identity_ambiguous');
  assertUniqueMessageIds(params.workingMessages, 'memory_refresh_message_identity_ambiguous');
  const internalById = new Map(
    params.internalUserMessages.map((message) => [message.id, message] as const),
  );
  const visibleWorkingMessages = params.workingMessages.filter((message) => {
    const internalMessage = internalById.get(message.id);
    if (!internalMessage) return true;
    if (!messagesMatch(message, internalMessage)) {
      throw new Error('internal_user_message_identity_mismatch');
    }
    return false;
  });
  return [...visibleWorkingMessages, ...params.internalUserMessages];
}
