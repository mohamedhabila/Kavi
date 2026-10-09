import type { Conversation } from '../../types/conversation';
import type { RewindUserMessageForResendResult } from '../../store/chatStoreTypes';
import { findTurnOpeningUserIndex, isSteeringUserMessage } from '../../utils/steeringMessages';

export const FOREGROUND_EDIT_RESEND_REWIND_REASON =
  'Cancelled because the active run was rewound for an edited resend.';
export const FOREGROUND_RETRY_REWIND_REASON =
  'Cancelled because the active run was rewound for a retry.';

type RewindConversationActions = {
  cancelConversationRunForRewind: (conversationId: string, reason: string) => void;
  retireConversationSourcesForRewind: (
    conversationId: string,
    messageId: string,
    reason: 'message_edit' | 'message_retry',
  ) => void;
  rewindUserMessageForResend: (
    conversationId: string,
    messageId: string,
    content: string,
  ) => RewindUserMessageForResendResult;
};

/**
 * The request a retry resends: the user message that opened the answer's turn, carrying
 * the words of every message that steered it, since the answer being retried read them.
 */
function findRetryRequest(
  conversation: Conversation,
  assistantMessageId: string,
): { id: string; content: string } | undefined {
  const assistantMessageIndex = conversation.messages.findIndex(
    (message) => message.id === assistantMessageId,
  );
  if (assistantMessageIndex <= 0) {
    return undefined;
  }

  const requestIndex = findTurnOpeningUserIndex(conversation.messages, assistantMessageIndex);
  const request = conversation.messages[requestIndex];
  if (!request) {
    return undefined;
  }
  const steeringContent = conversation.messages
    .slice(requestIndex + 1, assistantMessageIndex)
    .filter(isSteeringUserMessage)
    .map((message) => message.content);
  return {
    id: request.id,
    content: [request.content, ...steeringContent].filter((text) => text.trim()).join('\n\n'),
  };
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
  params.actions.retireConversationSourcesForRewind(
    params.conversationId,
    params.editingMessageId,
    'message_edit',
  );
  const result = params.actions.rewindUserMessageForResend(
    params.conversationId,
    params.editingMessageId,
    params.text,
  );
  if (result.status === 'rejected') {
    throw new Error(`foreground_conversation_rewind_commit_${result.reason}`);
  }
  return true;
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

  const retryUserMessage = findRetryRequest(params.conversation, params.assistantMessageId);
  if (!retryUserMessage) {
    return false;
  }

  params.actions.cancelConversationRunForRewind(
    params.conversationId,
    FOREGROUND_RETRY_REWIND_REASON,
  );
  params.actions.retireConversationSourcesForRewind(
    params.conversationId,
    retryUserMessage.id,
    'message_retry',
  );
  const result = params.actions.rewindUserMessageForResend(
    params.conversationId,
    retryUserMessage.id,
    retryUserMessage.content,
  );
  if (result.status === 'rejected') {
    throw new Error(`foreground_conversation_rewind_commit_${result.reason}`);
  }
  return true;
}
