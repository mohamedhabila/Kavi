import type { Conversation, ModelProjectionOwner } from '../types/conversation';
import type { Message } from '../types/message';
import {
  isValidModelProjectionOwner,
  modelProjectionOwnersEqual,
} from '../utils/modelProjectionOwner';
import { capMessages } from './chatStoreHelpers';
import { requestChatStorePersistenceCheckpoint } from './chatStorePersistence';
import { useChatStore } from './useChatStore';
import { unrefTimerIfSupported } from '../utils/timers';

const MODEL_PROJECTION_RELEASE_TIMEOUT_MS = 30_000;

export type ModelProjectionClaimResult =
  | 'claimed'
  | 'conversation_missing'
  | 'owner_conflict'
  | 'request_missing'
  | 'assistant_missing'
  | 'assistant_invalid';

export type ModelProjectionReleaseResult = 'released' | 'conversation_missing' | 'owner_changed';

export type OwnedModelProjectionMutationResult<T> =
  | { kind: 'applied'; value: T }
  | { kind: 'conversation_missing' }
  | { kind: 'owner_changed' }
  | { kind: 'rejected'; value: T };

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export function ownsModelProjection(conversationId: string, owner: ModelProjectionOwner): boolean {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  return modelProjectionOwnersEqual(conversation?.modelProjectionOwner, owner);
}

/** Wait for an earlier generation to release the exclusive conversation projection. */
export async function waitForModelProjectionAvailability(input: {
  conversationId: string;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? MODEL_PROJECTION_RELEASE_TIMEOUT_MS;
  if (!validId(input.conversationId) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('model_projection_invalid_wait');
  }
  const hasOwner = () =>
    Boolean(
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === input.conversationId)
        ?.modelProjectionOwner,
    );
  if (!hasOwner()) return;
  if (input.signal.aborted) throw new Error('model_projection_wait_cancelled');

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => finish(new Error('model_projection_wait_cancelled'));
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      input.signal.removeEventListener('abort', onAbort);
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    unsubscribe = useChatStore.subscribe(() => {
      if (!hasOwner()) finish();
    });
    input.signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(new Error('model_projection_wait_timeout')), timeoutMs);
    unrefTimerIfSupported(timer);
    if (!hasOwner()) finish();
  });
}

export function claimModelProjection(input: {
  conversationId: string;
  owner: ModelProjectionOwner;
  messagesBeforeAssistant?: Message[];
  assistantMessage?: Message;
}): ModelProjectionClaimResult {
  if (
    !validId(input.conversationId) ||
    !isValidModelProjectionOwner(input.owner) ||
    input.owner.controlEpoch !== 0 ||
    (input.assistantMessage &&
      (input.assistantMessage.id !== input.owner.assistantMessageId ||
        input.assistantMessage.role !== 'assistant')) ||
    input.messagesBeforeAssistant?.some(
      (message) =>
        !validId(message.id) ||
        message.id === input.owner.assistantMessageId ||
        message.role === 'assistant',
    )
  ) {
    return 'assistant_invalid';
  }

  let result: ModelProjectionClaimResult = 'conversation_missing';
  let changed = false;
  useChatStore.setState((state) => {
    const conversationIndex = state.conversations.findIndex(
      (conversation) => conversation.id === input.conversationId,
    );
    if (conversationIndex < 0) return state;
    const conversation = state.conversations[conversationIndex];
    const currentOwner = conversation.modelProjectionOwner;
    if (currentOwner && !modelProjectionOwnersEqual(currentOwner, input.owner)) {
      result = 'owner_conflict';
      return state;
    }
    const assistant = conversation.messages.find(
      (message) => message.id === input.owner.assistantMessageId,
    );
    const existingMessageIds = new Set(conversation.messages.map((message) => message.id));
    const messagesBeforeAssistant = (input.messagesBeforeAssistant ?? []).filter(
      (message) => !existingMessageIds.has(message.id),
    );
    const requestExists =
      existingMessageIds.has(input.owner.requestMessageId) ||
      messagesBeforeAssistant.some((message) => message.id === input.owner.requestMessageId);
    if (!requestExists) {
      result = 'request_missing';
      return state;
    }
    if (assistant && assistant.role !== 'assistant') {
      result = 'assistant_invalid';
      return state;
    }
    if (!assistant && !input.assistantMessage) {
      result = 'assistant_missing';
      return state;
    }
    result = 'claimed';
    if (currentOwner && assistant && messagesBeforeAssistant.length === 0) return state;
    const messages = capMessages([
      ...conversation.messages,
      ...messagesBeforeAssistant,
      ...(assistant ? [] : [input.assistantMessage!]),
    ]);
    const nextConversation: Conversation = {
      ...conversation,
      messages,
      modelProjectionOwner: input.owner,
      updatedAt: Math.max(
        conversation.updatedAt,
        input.assistantMessage?.timestamp ?? conversation.updatedAt,
      ),
    };
    const conversations = [...state.conversations];
    conversations[conversationIndex] = nextConversation;
    changed = true;
    return { conversations };
  });
  if (changed) requestChatStorePersistenceCheckpoint();
  return result;
}

export function releaseModelProjection(input: {
  conversationId: string;
  owner: ModelProjectionOwner;
}): ModelProjectionReleaseResult {
  let result: ModelProjectionReleaseResult = 'conversation_missing';
  let changed = false;
  useChatStore.setState((state) => {
    const conversationIndex = state.conversations.findIndex(
      (conversation) => conversation.id === input.conversationId,
    );
    if (conversationIndex < 0) return state;
    const conversation = state.conversations[conversationIndex];
    if (!modelProjectionOwnersEqual(conversation.modelProjectionOwner, input.owner)) {
      result = 'owner_changed';
      return state;
    }
    const { modelProjectionOwner: _owner, ...releasedConversation } = conversation;
    const conversations = [...state.conversations];
    conversations[conversationIndex] = releasedConversation;
    result = 'released';
    changed = true;
    return { conversations };
  });
  if (changed) requestChatStorePersistenceCheckpoint();
  return result;
}

export function mutateOwnedModelProjection<T>(input: {
  conversationId: string;
  owner: ModelProjectionOwner;
  mutate: (
    conversation: Conversation,
  ) => { kind: 'applied'; conversation: Conversation; value: T } | { kind: 'rejected'; value: T };
}): OwnedModelProjectionMutationResult<T> {
  let result: OwnedModelProjectionMutationResult<T> = {
    kind: 'conversation_missing',
  };
  let changed = false;
  useChatStore.setState((state) => {
    const conversationIndex = state.conversations.findIndex(
      (conversation) => conversation.id === input.conversationId,
    );
    if (conversationIndex < 0) return state;
    const conversation = state.conversations[conversationIndex];
    if (!modelProjectionOwnersEqual(conversation.modelProjectionOwner, input.owner)) {
      result = { kind: 'owner_changed' };
      return state;
    }
    const mutation = input.mutate(conversation);
    if (mutation.kind === 'rejected') {
      result = mutation;
      return state;
    }
    const conversations = [...state.conversations];
    conversations[conversationIndex] = mutation.conversation;
    result = { kind: 'applied', value: mutation.value };
    changed = mutation.conversation !== conversation;
    return changed ? { conversations } : state;
  });
  if (changed) requestChatStorePersistenceCheckpoint();
  return result;
}
