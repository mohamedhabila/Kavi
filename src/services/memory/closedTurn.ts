import type { Message } from '../../types/message';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';

export function findLastClosedTurn(messages: Message[]): {
  user: Message | undefined;
  assistant: Message | undefined;
} {
  const normalized = normalizeTerminalClosedTurnMessages(messages);
  const assistant = findLastClosedAssistant(normalized);
  if (!assistant) return { user: undefined, assistant: undefined };
  const user = findLastUserBefore(normalized, assistant.id);
  return { user, assistant };
}

/**
 * Promote a tool-only terminal assistant in the latest user turn slice to final
 * metadata so turn closure is structural (graph-owned turn boundary), not NL-based.
 */
export function normalizeTerminalClosedTurnMessages(messages: Message[]): Message[] {
  const lastUserIndex = findLastMessageIndex(messages, 'user');
  if (lastUserIndex < 0) return messages;

  let lastAssistantIndex = -1;
  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      lastAssistantIndex = index;
      break;
    }
  }
  if (lastAssistantIndex < 0) return messages;

  const assistant = messages[lastAssistantIndex]!;
  const hasContent = Boolean(assistant.content?.trim());
  if (isClosedAssistantMessage(assistant)) return messages;

  if (!hasContent) {
    const updated = [...messages];
    updated[lastAssistantIndex] = {
      ...assistant,
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: assistant.assistantMetadata?.finishReason ?? 'stop',
      }),
    };
    return updated;
  }

  return messages;
}

function findLastMessageIndex(messages: Message[], role: Message['role']): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) return index;
  }
  return -1;
}

function findLastClosedAssistant(messages: Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isClosedAssistantMessage(message)) return message;
  }
  return undefined;
}

function isClosedAssistantMessage(message: Message | undefined): boolean {
  if (!message || message.role !== 'assistant' || !isTerminalAssistantMessage(message)) {
    return false;
  }
  const hasContent = Boolean(message.content?.trim());
  const hasToolCalls = (message.toolCalls?.length ?? 0) > 0;
  return (
    hasContent ||
    hasToolCalls ||
    (message.assistantMetadata?.kind === 'final' &&
      message.assistantMetadata.completionStatus === 'complete')
  );
}

function isTerminalAssistantMessage(message: Message): boolean {
  if (!message.assistantMetadata) return true;
  if (message.assistantMetadata.finishReason === 'yielded') return false;
  return (
    message.assistantMetadata.kind === 'final' &&
    message.assistantMetadata.completionStatus === 'complete'
  );
}

function findLastUserBefore(
  messages: Message[],
  beforeId: string | undefined,
): Message | undefined {
  if (!beforeId) return undefined;
  const index = messages.findIndex((message) => message.id === beforeId);
  for (let current = Math.max(index, 0); current >= 0; current -= 1) {
    if (messages[current]?.role === 'user') return messages[current];
  }
  return undefined;
}
