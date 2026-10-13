import { closeMemoryDb } from '../../services/memory/database';
import { catchUpMemoryCapture } from '../../services/memory/core/memoryCapture';
import { cancelMemoryExtraction } from '../../services/memory/core/memoryExtractionWorker';
import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import { useChatStore } from '../../store/useChatStore';
import type { ForegroundScenarioLifecycleSnapshot } from './foregroundScenarioDriverTypes';
import { captureForegroundScenarioMemoryItems } from './foregroundScenarioMemoryItemsEvidence';

function durableMemoryIdentity(): string {
  const { capturedAt: _capturedAt, ...durableState } = captureForegroundScenarioMemoryItems();
  return JSON.stringify(durableState);
}

function requirePersistedConversation(conversationId: string, lastMessageId: string | null): void {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  if (!conversation) {
    throw new Error(`Conversation ${conversationId} was not restored after app relaunch.`);
  }
  if (lastMessageId && !conversation.messages.some((message) => message.id === lastMessageId)) {
    throw new Error(
      `Conversation ${conversationId} lost its latest persisted message on relaunch.`,
    );
  }
}

async function discardInMemoryChatStateWithoutPersisting(): Promise<void> {
  const persistedOptions = useChatStore.persist.getOptions();
  const storage = persistedOptions.storage;
  if (!storage) throw new Error('Chat persistence storage is unavailable.');

  useChatStore.persist.setOptions({
    storage: {
      getItem: async () => null,
      setItem: async () => undefined,
      removeItem: async () => undefined,
    },
  });
  try {
    useChatStore.setState(useChatStore.getInitialState(), true);
  } finally {
    useChatStore.persist.setOptions({ storage });
  }
}

/** Closes and reopens the app's stores; a launch then catches up on memory as startup does. */
export async function relaunchForegroundScenarioApp(params: {
  conversationId: string;
}): Promise<Readonly<{ lifecycle: ForegroundScenarioLifecycleSnapshot }>> {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId);
  if (!conversation) throw new Error(`Conversation ${params.conversationId} is unavailable.`);
  const lastMessageId = conversation.messages[conversation.messages.length - 1]?.id ?? null;

  // Killing the app drops background extraction still queued in memory.
  cancelMemoryExtraction();
  const memoryStateAtClose = durableMemoryIdentity();
  await flushChatStorePersistenceNow();
  await discardInMemoryChatStateWithoutPersisting();
  if (
    useChatStore
      .getState()
      .conversations.some((candidate) => candidate.id === params.conversationId)
  ) {
    throw new Error('App relaunch did not discard the in-memory chat state.');
  }

  closeMemoryDb();
  await useChatStore.persist.rehydrate();
  requirePersistedConversation(params.conversationId, lastMessageId);
  if (durableMemoryIdentity() !== memoryStateAtClose) {
    throw new Error('Durable memory state changed across app relaunch.');
  }
  catchUpMemoryCapture(useChatStore.getState().conversations);

  return {
    lifecycle: {
      boundary: 'app_relaunch',
      chatStore: 'rehydrated',
      memoryStore: 'reopened',
    },
  };
}

/**
 * The user starts over in the one conversation (/new or /reset): its messages move to the
 * transcript archive, so the next turn's request carries none of them and only memory can
 * bring them back. The conversation and durable memory are unchanged.
 */
export function resetForegroundScenarioContext(params: { conversationId: string }): Readonly<{
  lifecycle: ForegroundScenarioLifecycleSnapshot;
}> {
  const before = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId);
  if (!before) throw new Error(`Conversation ${params.conversationId} is unavailable.`);
  const previousLiveMessageCount = before.messages.length;
  const memoryStateBefore = durableMemoryIdentity();
  if (!useChatStore.getState().resetConversationContext(params.conversationId)) {
    throw new Error('Context reset found no messages to archive.');
  }
  const after = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId);
  if (!after || after.messages.length !== 0) {
    throw new Error('Context reset left messages in the conversation.');
  }
  if (durableMemoryIdentity() !== memoryStateBefore) {
    throw new Error('Durable memory state changed while resetting the context.');
  }
  return {
    lifecycle: {
      boundary: 'context_reset',
      chatStore: 'context_archived',
      memoryStore: 'shared_global',
      previousLiveMessageCount,
      liveMessageCountAfter: 0,
    },
  };
}
