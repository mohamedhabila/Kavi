import type { Conversation } from '../../types/conversation';
import type { RewindUserMessageForResendResult } from '../../store/chatStoreTypes';

export const FOREGROUND_EDIT_RESEND_REWIND_REASON =
  'Cancelled because the active run was rewound for an edited resend.';
export const FOREGROUND_RETRY_REWIND_REASON =
  'Cancelled because the active run was rewound for a retry.';

type RewindConversationActions = {
  cancelConversationRunForRewind: (conversationId: string, reason: string) => void;
  rewindUserMessageForResend: (
    conversationId: string,
    messageId: string,
    content: string,
  ) => RewindUserMessageForResendResult;
};

function findRetryUserMessageId(
  conversation: Conversation,
  assistantMessageId: string,
): string | undefined {
  const assistantMessageIndex = conversation.messages.findIndex(
    (message) => message.id === assistantMessageId,
  );
  if (assistantMessageIndex <= 0) {
    return undefined;
  }

  for (let index = assistantMessageIndex - 1; index >= 0; index -= 1) {
    if (conversation.messages[index]?.role === 'user') {
      return conversation.messages[index]?.id;
    }
  }

  return undefined;
}

export function applyForegroundEditedResend(params: {
  actions: RewindConversationActions;
  conversationId?: string;
  editingMessageId?: string | null;
  text: string;
}): boolean {
  if (!params.conversationId || !params.editingMessageId) {
    return false;
  }

  params.actions.cancelConversationRunForRewind(
    params.conversationId,
    FOREGROUND_EDIT_RESEND_REWIND_REASON,
  );
  return (
    params.actions.rewindUserMessageForResend(
      params.conversationId,
      params.editingMessageId,
      params.text,
    ).status === 'applied'
  );
}

export function applyForegroundRetryResend(params: {
  actions: RewindConversationActions;
  assistantMessageId: string;
  conversation?: Conversation;
  conversationId?: string;
}): boolean {
  if (!params.conversation || !params.conversationId) {
    return false;
  }

  const retryUserMessageId = findRetryUserMessageId(params.conversation, params.assistantMessageId);
  if (!retryUserMessageId) {
    return false;
  }

  const retryUserMessage = params.conversation.messages.find(
    (message) => message.id === retryUserMessageId,
  );
  if (!retryUserMessage || retryUserMessage.role !== 'user') {
    return false;
  }

  params.actions.cancelConversationRunForRewind(
    params.conversationId,
    FOREGROUND_RETRY_REWIND_REASON,
  );
  return (
    params.actions.rewindUserMessageForResend(
      params.conversationId,
      retryUserMessage.id,
      retryUserMessage.content,
    ).status === 'applied'
  );
}
