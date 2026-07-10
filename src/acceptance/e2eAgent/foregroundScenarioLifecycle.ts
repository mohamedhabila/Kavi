import { cancelScheduledIngestionDrain } from '../../services/memory/ingestionQueue';
import {
  captureCompleteMemoryEvidenceForIsolatedEvaluation,
  type ScopedMemoryEvidenceSnapshot,
} from '../../services/memory/evidenceSnapshot';
import { closeMemoryDb } from '../../services/memory/sqlite-store';
import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import { useChatStore } from '../../store/useChatStore';
import type {
  ForegroundScenarioLifecycleSnapshot,
  ForegroundScenarioMemoryFinalState,
} from './foregroundScenarioDriverTypes';

type MemoryScope = ScopedMemoryEvidenceSnapshot['scope'];

function durableMemoryIdentity(snapshot: ForegroundScenarioMemoryFinalState): string {
  const { capturedAt: _capturedAt, ...durableState } = snapshot;
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
    throw new Error(`Conversation ${conversationId} lost its latest persisted message on relaunch.`);
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

export async function relaunchForegroundScenarioApp(params: {
  conversationId: string;
  memoryScope: MemoryScope;
  memoryStateBefore: ForegroundScenarioMemoryFinalState;
}): Promise<ForegroundScenarioLifecycleSnapshot> {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId);
  if (!conversation) throw new Error(`Conversation ${params.conversationId} is unavailable.`);
  const lastMessageId = conversation.messages[conversation.messages.length - 1]?.id ?? null;

  cancelScheduledIngestionDrain();
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
  const reopenedMemory = captureCompleteMemoryEvidenceForIsolatedEvaluation(params.memoryScope);
  if (durableMemoryIdentity(reopenedMemory) !== durableMemoryIdentity(params.memoryStateBefore)) {
    throw new Error('Durable memory state changed across app relaunch.');
  }

  return {
    boundary: 'app_relaunch',
    chatStore: 'rehydrated',
    memoryStore: 'reopened',
  };
}
