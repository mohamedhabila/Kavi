import type {
  Conversation,
  ForegroundModelProjectionOwner,
} from '../types/conversation';
import type { Message } from '../types/message';
import {
  foregroundModelProjectionOwnersEqual,
  isValidForegroundModelProjectionOwner,
} from '../utils/foregroundModelProjectionOwner';
import { capMessages } from './chatStoreHelpers';
import { requestChatStorePersistenceCheckpoint } from './chatStorePersistence';
import { useChatStore } from './useChatStore';

export type ForegroundModelProjectionClaimResult =
  | 'claimed'
  | 'conversation_missing'
  | 'owner_conflict'
  | 'assistant_missing'
  | 'assistant_invalid';

export type ForegroundModelProjectionReleaseResult =
  | 'released'
  | 'conversation_missing'
  | 'owner_changed';

export type OwnedForegroundModelProjectionMutationResult<T> =
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

export function ownsForegroundModelProjection(
  conversationId: string,
  owner: ForegroundModelProjectionOwner,
): boolean {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  return foregroundModelProjectionOwnersEqual(
    conversation?.foregroundModelProjectionOwner,
    owner,
  );
}

export function claimForegroundModelProjection(input: {
  conversationId: string;
  owner: ForegroundModelProjectionOwner;
  assistantMessage?: Message;
}): ForegroundModelProjectionClaimResult {
  if (
    !validId(input.conversationId) ||
    !isValidForegroundModelProjectionOwner(input.owner) ||
    input.owner.controlEpoch !== 0 ||
    (input.assistantMessage &&
      (input.assistantMessage.id !== input.owner.assistantMessageId ||
        input.assistantMessage.role !== 'assistant'))
  ) {
    return 'assistant_invalid';
  }

  let result: ForegroundModelProjectionClaimResult = 'conversation_missing';
  let changed = false;
  useChatStore.setState((state) => {
    const conversationIndex = state.conversations.findIndex(
      (conversation) => conversation.id === input.conversationId,
    );
    if (conversationIndex < 0) return state;
    const conversation = state.conversations[conversationIndex];
    const currentOwner = conversation.foregroundModelProjectionOwner;
    if (
      currentOwner &&
      !foregroundModelProjectionOwnersEqual(currentOwner, input.owner)
    ) {
      result = 'owner_conflict';
      return state;
    }
    const assistant = conversation.messages.find(
      (message) => message.id === input.owner.assistantMessageId,
    );
    if (assistant && assistant.role !== 'assistant') {
      result = 'assistant_invalid';
      return state;
    }
    if (!assistant && !input.assistantMessage) {
      result = 'assistant_missing';
      return state;
    }
    result = 'claimed';
    if (currentOwner && assistant) return state;
    const messages = assistant
      ? conversation.messages
      : capMessages([...conversation.messages, input.assistantMessage!]);
    const nextConversation: Conversation = {
      ...conversation,
      messages,
      foregroundModelProjectionOwner: input.owner,
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

export function releaseForegroundModelProjection(input: {
  conversationId: string;
  owner: ForegroundModelProjectionOwner;
}): ForegroundModelProjectionReleaseResult {
  let result: ForegroundModelProjectionReleaseResult = 'conversation_missing';
  let changed = false;
  useChatStore.setState((state) => {
    const conversationIndex = state.conversations.findIndex(
      (conversation) => conversation.id === input.conversationId,
    );
    if (conversationIndex < 0) return state;
    const conversation = state.conversations[conversationIndex];
    if (
      !foregroundModelProjectionOwnersEqual(
        conversation.foregroundModelProjectionOwner,
        input.owner,
      )
    ) {
      result = 'owner_changed';
      return state;
    }
    const { foregroundModelProjectionOwner: _owner, ...releasedConversation } = conversation;
    const conversations = [...state.conversations];
    conversations[conversationIndex] = releasedConversation;
    result = 'released';
    changed = true;
    return { conversations };
  });
  if (changed) requestChatStorePersistenceCheckpoint();
  return result;
}

export function mutateOwnedForegroundModelProjection<T>(input: {
  conversationId: string;
  owner: ForegroundModelProjectionOwner;
  mutate: (conversation: Conversation) =>
    | { kind: 'applied'; conversation: Conversation; value: T }
    | { kind: 'rejected'; value: T };
}): OwnedForegroundModelProjectionMutationResult<T> {
  let result: OwnedForegroundModelProjectionMutationResult<T> = {
    kind: 'conversation_missing',
  };
  let changed = false;
  useChatStore.setState((state) => {
    const conversationIndex = state.conversations.findIndex(
      (conversation) => conversation.id === input.conversationId,
    );
    if (conversationIndex < 0) return state;
    const conversation = state.conversations[conversationIndex];
    if (
      !foregroundModelProjectionOwnersEqual(
        conversation.foregroundModelProjectionOwner,
        input.owner,
      )
    ) {
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
