import { Message } from '../../types/message';
import { mergeMatchingToolCalls } from '../../utils/toolCallMatching';
import { resolveMessageAttachments } from '../../utils/messageAttachments';
import {
  buildDisplayProjectionSourceMessageIds,
  reconcileAssistantMessagesWithToolResults,
} from './messageProjectionReconciliation';

export interface DisplayResponseSegment {
  id: string;
  messageId: string;
  content: string;
  reasoning?: string;
  attachments?: Message['attachments'];
  toolCalls?: Message['toolCalls'];
  assistantMetadata?: Message['assistantMetadata'];
  timestamp: number;
  isError?: boolean;
  effectId?: Message['effectId'];
  subAgentEvent?: Message['subAgentEvent'];
}

export interface DisplayMessageItem {
  id: string;
  message: Message;
  sourceMessageIds: string[];
  projectionSourceMessageIds?: string[];
  retryMessageId?: string;
  responseSegments?: DisplayResponseSegment[];
}

function buildResponseSegment(
  message: Message,
  id = `segment-${message.id}`,
): DisplayResponseSegment {
  return {
    id,
    messageId: message.id,
    content: message.content,
    reasoning: message.reasoning,
    attachments: getMessageDisplayAttachments(message),
    toolCalls: message.toolCalls?.length ? message.toolCalls : undefined,
    assistantMetadata: message.assistantMetadata,
    timestamp: message.timestamp,
    isError: message.isError,
    effectId: message.effectId,
    subAgentEvent: message.subAgentEvent,
  };
}

function buildAssistantDisplayItem(
  assistantMessages: Message[],
  sourceMessages: Message[],
): DisplayMessageItem {
  const reconciledAssistantMessages = reconcileAssistantMessagesWithToolResults(
    assistantMessages,
    sourceMessages,
  );
  const mergedMessage =
    reconciledAssistantMessages.length === 1
      ? {
          ...reconciledAssistantMessages[0],
          attachments: getMessageDisplayAttachments(reconciledAssistantMessages[0]),
        }
      : mergeAssistantMessages(reconciledAssistantMessages);

  return {
    id: mergedMessage.id,
    message: mergedMessage,
    sourceMessageIds: assistantMessages.map((assistantMessage) => assistantMessage.id),
    projectionSourceMessageIds: buildDisplayProjectionSourceMessageIds(sourceMessages),
    retryMessageId: assistantMessages[assistantMessages.length - 1]?.id,
    responseSegments: buildResponseSegments(reconciledAssistantMessages),
  };
}

function buildSubAgentDisplayItem(subAgentMessages: Message[]): DisplayMessageItem {
  const firstMessage = subAgentMessages[0];
  const latestMessage = subAgentMessages[subAgentMessages.length - 1];

  return {
    id: firstMessage.id,
    message: {
      ...latestMessage,
      attachments: getMessageDisplayAttachments(latestMessage),
    },
    sourceMessageIds: subAgentMessages.map((message) => message.id),
    retryMessageId: latestMessage.id,
    responseSegments: buildResponseSegments(subAgentMessages),
  };
}

export function getMessageDisplayAttachments(message: Message): Message['attachments'] {
  return resolveMessageAttachments(message);
}

function mergeAttachments(messages: Message[]): Message['attachments'] {
  const attachments = messages.flatMap((message) => getMessageDisplayAttachments(message) || []);
  if (!attachments.length) {
    return undefined;
  }

  const merged: NonNullable<Message['attachments']> = [];
  for (const attachment of attachments) {
    const existingIndex = merged.findIndex(
      (candidate) =>
        candidate.id === attachment.id ||
        (candidate.type === attachment.type &&
          candidate.uri === attachment.uri &&
          candidate.name === attachment.name),
    );

    if (existingIndex >= 0) {
      merged[existingIndex] = attachment;
    } else {
      merged.push(attachment);
    }
  }

  return merged;
}

export function mergeAssistantMessages(messages: Message[]): Message {
  const content = messages
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');
  const reasoning = messages
    .map((message) => message.reasoning?.trim())
    .filter((value): value is string => !!value)
    .join('\n\n');
  const attachments = mergeAttachments(messages);
  const toolCalls = messages.reduce<Message['toolCalls'] | undefined>(
    (currentToolCalls, message) => mergeMatchingToolCalls(currentToolCalls, message.toolCalls),
    undefined,
  );
  const latestEffect = [...messages].reverse().find((message) => message.effectId)?.effectId;
  const latestAssistantMetadata = [...messages]
    .reverse()
    .find((message) => message.assistantMetadata)?.assistantMetadata;

  return {
    ...messages[0],
    id: `assistant-group-${messages[0].id}`,
    content,
    attachments,
    reasoning: reasoning || undefined,
    toolCalls,
    assistantMetadata: latestAssistantMetadata,
    effectId: latestEffect,
    isError: messages.some((message) => message.isError),
    timestamp: messages[0].timestamp,
  };
}

function buildResponseSegments(messages: Message[]): DisplayResponseSegment[] {
  return messages.map((message) => buildResponseSegment(message));
}

export function buildDisplayMessages(messages: Message[]): DisplayMessageItem[] {
  const displayItems: DisplayMessageItem[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'tool') {
      continue;
    }

    if (message.role !== 'assistant') {
      displayItems.push({
        id: message.id,
        message,
        sourceMessageIds: [message.id],
      });
      continue;
    }

    if (message.subAgentEvent) {
      const subAgentMessages = [message];
      let cursor = index + 1;

      while (cursor < messages.length) {
        const nextMessage = messages[cursor];
        if (nextMessage.role === 'tool') {
          cursor += 1;
          continue;
        }

        if (nextMessage.role !== 'assistant' || !nextMessage.subAgentEvent) {
          break;
        }

        if (
          nextMessage.subAgentEvent.snapshot.sessionId !== message.subAgentEvent.snapshot.sessionId
        ) {
          break;
        }

        subAgentMessages.push(nextMessage);
        cursor += 1;
      }

      displayItems.push(buildSubAgentDisplayItem(subAgentMessages));
      index = cursor - 1;
      continue;
    }

    const assistantMessages = [message];
    const sourceMessages = [message];
    let cursor = index + 1;

    while (cursor < messages.length) {
      const nextMessage = messages[cursor];
      if (nextMessage.role === 'user') {
        break;
      }

      if (nextMessage.role === 'tool') {
        sourceMessages.push(nextMessage);
        cursor += 1;
        continue;
      }

      if (nextMessage.role === 'assistant') {
        assistantMessages.push(nextMessage);
        sourceMessages.push(nextMessage);
      }

      cursor += 1;
    }

    displayItems.push(buildAssistantDisplayItem(assistantMessages, sourceMessages));

    index = cursor - 1;
  }

  return displayItems;
}
