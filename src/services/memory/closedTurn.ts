import type { Message } from '../../types/message';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
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
  const metadata = sourceEnd.message.assistantMetadata;
  if (
    metadata?.kind !== 'final' ||
    metadata.completionStatus !== 'complete' ||
    metadata.finishReason === 'yielded'
  ) {
    return { status: 'invalid', reason: 'source_end_not_closed' };
  }
  for (let index = sourceEnd.index + 1; index < messages.length; index += 1) {
    const role = messages[index]?.role;
    if (role === 'user') break;
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
