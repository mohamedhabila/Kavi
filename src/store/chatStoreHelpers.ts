import type { AssistantMessageMetadata, Message, ToolCall } from '../types/message';
import type { Attachment } from '../types/attachment';
import type { Conversation } from '../types/conversation';
import { resolveWorkspaceTargetId } from '../services/workspaces/config';
import { useSettingsStore } from './useSettingsStore';

export const MAX_MESSAGES_PER_CONVERSATION = 500;

export function resolveConversationWorkspaceTargetId(
  workspaceTargetId?: string,
): string | undefined {
  const settings = useSettingsStore.getState();
  return (
    resolveWorkspaceTargetId({
      workspaceTargetId,
      defaultWorkspaceTargetId: settings.defaultWorkspaceTargetId,
      workspaceTargets: settings.workspaceTargets,
    }) || undefined
  );
}

export function capMessages(messages: Message[]): Message[] {
  if (messages.length <= MAX_MESSAGES_PER_CONVERSATION) {
    return messages;
  }

  return [messages[0], ...messages.slice(-(MAX_MESSAGES_PER_CONVERSATION - 1))];
}

export function areAssistantMessageMetadataEqual(
  left: AssistantMessageMetadata | undefined,
  right: AssistantMessageMetadata | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return !left && !right;
  }

  return (
    left.kind === right.kind &&
    left.completionStatus === right.completionStatus &&
    left.finishReason === right.finishReason &&
    left.terminalReason === right.terminalReason
  );
}

export function areToolCallsEqual(
  left: ToolCall | undefined,
  right: ToolCall | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return !left && !right;
  }

  return (
    left.id === right.id &&
    left.name === right.name &&
    left.arguments === right.arguments &&
    left.raw === right.raw &&
    left.status === right.status &&
    left.startedAt === right.startedAt &&
    left.updatedAt === right.updatedAt &&
    left.completedAt === right.completedAt &&
    left.progressText === right.progressText &&
    left.result === right.result &&
    left.error === right.error
  );
}

export function areAttachmentsEqual(
  left: Attachment[] | undefined,
  right: Attachment[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left?.length && !right?.length) {
    return true;
  }

  if (!left || !right || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftAttachment = left[index];
    const rightAttachment = right[index];
    if (
      leftAttachment.id !== rightAttachment.id ||
      leftAttachment.type !== rightAttachment.type ||
      leftAttachment.uri !== rightAttachment.uri ||
      leftAttachment.name !== rightAttachment.name ||
      leftAttachment.mimeType !== rightAttachment.mimeType ||
      leftAttachment.size !== rightAttachment.size ||
      leftAttachment.base64 !== rightAttachment.base64 ||
      leftAttachment.workspacePath !== rightAttachment.workspacePath ||
      leftAttachment.durationMs !== rightAttachment.durationMs ||
      leftAttachment.transcript !== rightAttachment.transcript ||
      JSON.stringify(leftAttachment.waveformLevels ?? []) !==
        JSON.stringify(rightAttachment.waveformLevels ?? [])
    ) {
      return false;
    }
  }

  return true;
}

export function updateConversationById(
  conversations: Conversation[],
  conversationId: string,
  updater: (conversation: Conversation) => Conversation,
): Conversation[] | undefined {
  const conversationIndex = conversations.findIndex(
    (conversation) => conversation.id === conversationId,
  );
  if (conversationIndex < 0) {
    return undefined;
  }

  const conversation = conversations[conversationIndex];
  const nextConversation = updater(conversation);
  if (nextConversation === conversation) {
    return undefined;
  }

  const nextConversations = [...conversations];
  nextConversations[conversationIndex] = nextConversation;
  return nextConversations;
}

export function updateConversationMessageById(
  conversations: Conversation[],
  conversationId: string,
  messageId: string,
  updater: (message: Message) => Message,
): Conversation[] | undefined {
  return updateConversationById(conversations, conversationId, (conversation) => {
    const messageIndex = conversation.messages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) {
      return conversation;
    }

    const message = conversation.messages[messageIndex];
    const nextMessage = updater(message);
    if (nextMessage === message) {
      return conversation;
    }

    const nextMessages = [...conversation.messages];
    nextMessages[messageIndex] = nextMessage;
    return {
      ...conversation,
      messages: nextMessages,
    };
  });
}
