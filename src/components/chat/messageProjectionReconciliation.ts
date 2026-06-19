import type { Message, ToolCall } from '../../types/message';
import {
  findMatchingToolCallIndexWithinMessage,
  mergeMatchingToolCall,
} from '../../utils/toolCallMatching';

function cloneToolCalls(toolCalls?: ToolCall[]): ToolCall[] | undefined {
  return toolCalls?.map((toolCall) => ({ ...toolCall }));
}

function cloneAssistantMessageForProjection(message: Message): Message {
  return {
    ...message,
    toolCalls: cloneToolCalls(message.toolCalls),
  };
}

function mergeToolResultIntoAssistantMessages(
  assistantMessages: Message[],
  toolMessage: Message,
): Message[] {
  if (!toolMessage.toolCalls?.length) {
    return assistantMessages;
  }

  let nextAssistantMessages = assistantMessages;
  for (const incomingToolCall of toolMessage.toolCalls) {
    for (let index = nextAssistantMessages.length - 1; index >= 0; index -= 1) {
      const candidateMessage = nextAssistantMessages[index];
      const candidateToolCalls = candidateMessage?.toolCalls;
      if (!candidateToolCalls?.length) {
        continue;
      }

      const matchIndex =
        (toolMessage.toolCallId
          ? candidateToolCalls.findIndex((toolCall) => toolCall.id === toolMessage.toolCallId)
          : -1) >= 0
          ? candidateToolCalls.findIndex((toolCall) => toolCall.id === toolMessage.toolCallId)
          : findMatchingToolCallIndexWithinMessage(candidateToolCalls, incomingToolCall);

      if (matchIndex < 0) {
        continue;
      }

      const nextToolCalls = [...candidateToolCalls];
      nextToolCalls[matchIndex] = mergeMatchingToolCall(
        nextToolCalls[matchIndex],
        incomingToolCall,
      );
      nextAssistantMessages = nextAssistantMessages.map((message, messageIndex) =>
        messageIndex === index
          ? {
              ...candidateMessage,
              toolCalls: nextToolCalls,
            }
          : message,
      );
      break;
    }
  }

  return nextAssistantMessages;
}

function buildAssistantProjectionMessageMap(assistantMessages: Message[]): Map<string, Message> {
  return new Map(
    assistantMessages.map((message) => [message.id, cloneAssistantMessageForProjection(message)]),
  );
}

function getProjectionAssistantMessages(
  assistantMessageIds: string[],
  assistantMessagesById: ReadonlyMap<string, Message>,
): Message[] {
  return assistantMessageIds
    .map((assistantMessageId) => assistantMessagesById.get(assistantMessageId))
    .filter((message): message is Message => !!message);
}

export function buildReconciledAssistantMessages(
  assistantMessages: Message[],
  sourceMessages: Message[],
): Message[] {
  if (assistantMessages.length === 0) {
    return [];
  }

  const assistantMessagesById = buildAssistantProjectionMessageMap(assistantMessages);
  const seenAssistantMessageIds: string[] = [];

  for (const sourceMessage of sourceMessages) {
    if (sourceMessage.role === 'assistant') {
      if (assistantMessagesById.has(sourceMessage.id)) {
        seenAssistantMessageIds.push(sourceMessage.id);
      }
      continue;
    }

    if (sourceMessage.role !== 'tool') {
      continue;
    }

    const mergedAssistantMessages = mergeToolResultIntoAssistantMessages(
      getProjectionAssistantMessages(seenAssistantMessageIds, assistantMessagesById),
      sourceMessage,
    );

    mergedAssistantMessages.forEach((message, index) => {
      assistantMessagesById.set(seenAssistantMessageIds[index], message);
    });
  }

  return assistantMessages
    .map((assistantMessage) => assistantMessagesById.get(assistantMessage.id))
    .filter((message): message is Message => !!message);
}

export function reconcileAssistantMessagesWithToolResults(
  assistantMessages: Message[],
  sourceMessages: Message[],
): Message[] {
  return buildReconciledAssistantMessages(assistantMessages, sourceMessages);
}

export function buildDisplayProjectionSourceMessageIds(messages: Message[]): string[] {
  return messages
    .filter((message) => message.role === 'assistant' || message.role === 'tool')
    .map((message) => message.id);
}
