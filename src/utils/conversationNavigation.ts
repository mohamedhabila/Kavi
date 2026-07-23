import type { Conversation } from '../types/conversation';

function conversationActivityTime(conversation: Conversation): number {
  return conversation.updatedAt ?? conversation.createdAt ?? 0;
}

export function getNavigableConversations(
  conversations: ReadonlyArray<Conversation>,
): Conversation[] {
  return conversations
    .map((conversation, index) => ({ conversation, index }))
    .filter(({ conversation }) => conversation.archivedFromMigration !== true)
    .sort((left, right) => {
      const activityDelta =
        conversationActivityTime(right.conversation) - conversationActivityTime(left.conversation);
      return activityDelta || left.index - right.index;
    })
    .map(({ conversation }) => conversation);
}

export function filterConversationsByTitle(
  conversations: ReadonlyArray<Conversation>,
  query: string,
): Conversation[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [...conversations];
  }

  return conversations.filter((conversation) =>
    conversation.title.toLocaleLowerCase().includes(normalizedQuery),
  );
}
