import type { Message } from '../../types/message';
import { hasTerminalAssistantCompletionMetadata } from '../../utils/assistantMessageMetadata';
import { resolveUniqueMessageIdentity } from './priorUserMessageIdentity';

export type ExactClosedTurnFailureReason =
  | 'source_end_unavailable'
  | 'source_end_not_closed'
  | 'source_end_not_terminal'
  | 'source_user_identity_invalid'
  | 'prior_user_identity_invalid';

export type ExactClosedTurnResolution =
  | {
      status: 'resolved';
      assistant: Message;
      user: Message | undefined;
      sourceStartMessageId: string | null;
      sourceEndMessageId: string;
      priorUserMessageId: string | null;
    }
  | { status: 'invalid'; reason: ExactClosedTurnFailureReason };

/** Resolve one exact live turn boundary. This function never falls back to an older final. */
export function resolveClosedTurnEndingAt(
  messages: readonly Message[],
  sourceEndMessageId: string,
): ExactClosedTurnResolution {
  const sourceEnd = resolveUniqueMessageIdentity(messages, sourceEndMessageId);
  if (sourceEnd.status === 'invalid' || sourceEnd.message.role !== 'assistant') {
    return { status: 'invalid', reason: 'source_end_unavailable' };
  }
  if (!hasTerminalAssistantCompletionMetadata(sourceEnd.message)) {
    return { status: 'invalid', reason: 'source_end_not_closed' };
  }
  for (let index = sourceEnd.index + 1; index < messages.length; index += 1) {
    const message = messages[index];
    const role = message?.role;
    if (role === 'user') break;
    if (role === 'assistant' && message.subAgentEvent) continue;
    if (role === 'assistant' || role === 'tool') {
      return { status: 'invalid', reason: 'source_end_not_terminal' };
    }
  }

  let sourceUserIndex = -1;
  for (let index = sourceEnd.index - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      sourceUserIndex = index;
      break;
    }
  }
  const user = sourceUserIndex >= 0 ? messages[sourceUserIndex] : undefined;
  if (user && resolveUniqueMessageIdentity(messages, user.id).status === 'invalid') {
    return { status: 'invalid', reason: 'source_user_identity_invalid' };
  }

  let priorUserMessageId: string | null = null;
  for (let index = sourceUserIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.role !== 'user') continue;
    if (resolveUniqueMessageIdentity(messages, candidate.id).status === 'invalid') {
      return { status: 'invalid', reason: 'prior_user_identity_invalid' };
    }
    priorUserMessageId = candidate.id;
    break;
  }

  return {
    status: 'resolved',
    assistant: sourceEnd.message,
    user,
    sourceStartMessageId: user?.id ?? null,
    sourceEndMessageId: sourceEnd.message.id,
    priorUserMessageId,
  };
}

export function findLastClosedTurn(messages: Message[]): {
  user: Message | undefined;
  assistant: Message | undefined;
} {
  const assistant = findLastClosedAssistant(messages);
  if (!assistant) return { user: undefined, assistant: undefined };
  const user = findLastUserBefore(messages, assistant.id);
  return { user, assistant };
}

function findLastClosedAssistant(messages: Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isClosedAssistantMessage(message)) return message;
  }
  return undefined;
}

function isClosedAssistantMessage(message: Message | undefined): boolean {
  return Boolean(message && hasTerminalAssistantCompletionMetadata(message));
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
