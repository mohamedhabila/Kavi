import type { Conversation } from '../types/conversation';
import type { RewindUserMessageForResendResult } from './chatStoreTypes';

type RewindUserMessageRejection = Extract<RewindUserMessageForResendResult, { status: 'rejected' }>;

export type RewindUserMessageEligibility =
  | Readonly<{
      status: 'eligible';
      conversationIndex: number;
      messageIndex: number;
    }>
  | RewindUserMessageRejection;

/** Pure identity and role preflight shared by durable retirement and the store commit. */
export function resolveRewindUserMessageEligibility(input: {
  conversations: readonly Conversation[];
  conversationId: string;
  messageId: string;
}): RewindUserMessageEligibility {
  const conversationIndexes = input.conversations.flatMap((conversation, index) =>
    conversation.id === input.conversationId ? [index] : [],
  );
  if (conversationIndexes.length === 0) {
    return { status: 'rejected', reason: 'conversation_unavailable' };
  }
  if (conversationIndexes.length !== 1) {
    return { status: 'rejected', reason: 'conversation_identity_invalid' };
  }

  const conversationIndex = conversationIndexes[0]!;
  const conversation = input.conversations[conversationIndex]!;
  const messageIndexes = conversation.messages.flatMap((message, index) =>
    message.id === input.messageId ? [index] : [],
  );
  if (messageIndexes.length === 0) {
    return { status: 'rejected', reason: 'message_unavailable' };
  }
  if (messageIndexes.length !== 1) {
    return { status: 'rejected', reason: 'message_identity_invalid' };
  }

  const messageIndex = messageIndexes[0]!;
  if (conversation.messages[messageIndex]!.role !== 'user') {
    return { status: 'rejected', reason: 'message_ineligible' };
  }
  return { status: 'eligible', conversationIndex, messageIndex };
}
