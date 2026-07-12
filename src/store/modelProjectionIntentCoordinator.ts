import type { ModelProjectionOwner } from '../types/conversation';
import type { Message } from '../types/message';
import { hasSettledFinalAssistantMetadata } from '../utils/assistantMessageMetadata';
import { claimModelProjection, type ModelProjectionClaimResult } from './modelProjectionOwnership';
import { useChatStore } from './useChatStore';

const modelProjectionIntentTokens = new Map<string, Map<string, number>>();

export interface ModelProjectionIntent {
  readonly conversationId: string;
  readonly token: string;
  release(): void;
}

export type ScheduledModelProjectionClaimResult =
  | ModelProjectionClaimResult
  | 'model_projection_intent'
  | 'unsettled_conversation_tail';

function normalizedId(value: string): string | undefined {
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

export function beginModelProjectionIntent(
  conversationId: string,
  token: string,
): ModelProjectionIntent {
  const normalizedConversationId = normalizedId(conversationId);
  const normalizedToken = normalizedId(token);
  if (!normalizedConversationId || !normalizedToken) {
    throw new Error('model_projection_intent_invalid');
  }
  const tokens =
    modelProjectionIntentTokens.get(normalizedConversationId) ?? new Map<string, number>();
  tokens.set(normalizedToken, (tokens.get(normalizedToken) ?? 0) + 1);
  modelProjectionIntentTokens.set(normalizedConversationId, tokens);

  let released = false;
  return {
    conversationId: normalizedConversationId,
    token: normalizedToken,
    release: () => {
      if (released) return;
      released = true;
      const currentTokens = modelProjectionIntentTokens.get(normalizedConversationId);
      const count = currentTokens?.get(normalizedToken) ?? 0;
      if (count <= 1) currentTokens?.delete(normalizedToken);
      else currentTokens?.set(normalizedToken, count - 1);
      if (currentTokens?.size === 0) {
        modelProjectionIntentTokens.delete(normalizedConversationId);
      }
    },
  };
}

export function hasModelProjectionIntent(conversationId: string): boolean {
  return (modelProjectionIntentTokens.get(conversationId)?.size ?? 0) > 0;
}

function hasUnsettledForeignTail(
  messages: readonly Message[],
  allowedRequestMessageId: string,
): boolean {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0 || messages[lastUserIndex].id === allowedRequestMessageId) return false;
  const tail = messages.slice(lastUserIndex + 1);
  let terminalAssistantIndex = -1;
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    if (tail[index].role === 'assistant' && !tail[index].subAgentEvent) {
      terminalAssistantIndex = index;
      break;
    }
  }
  if (
    terminalAssistantIndex < 0 ||
    !hasSettledFinalAssistantMetadata(tail[terminalAssistantIndex])
  ) {
    return true;
  }
  return tail
    .slice(terminalAssistantIndex + 1)
    .some((message) => message.role === 'assistant' || message.role === 'tool');
}

/**
 * The intent check, unresolved-tail check, and store claim are deliberately
 * synchronous. No competing request can interleave between the check and the
 * exclusive owner mutation in the same JavaScript turn.
 */
export function tryClaimScheduledModelProjection(input: {
  conversationId: string;
  owner: ModelProjectionOwner;
  messagesBeforeAssistant?: Message[];
  assistantMessage?: Message;
}): ScheduledModelProjectionClaimResult {
  if (hasModelProjectionIntent(input.conversationId)) {
    return 'model_projection_intent';
  }
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === input.conversationId);
  if (
    conversation &&
    hasUnsettledForeignTail(conversation.messages, input.owner.requestMessageId)
  ) {
    return 'unsettled_conversation_tail';
  }
  return claimModelProjection(input);
}

export function resetModelProjectionIntentCoordinatorForTests(): void {
  modelProjectionIntentTokens.clear();
}
