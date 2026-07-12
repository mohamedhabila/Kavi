import { cancelScheduledIngestionDrain } from '../../services/memory/ingestionQueue';
import {
  captureCompleteMemoryEvidenceForIsolatedEvaluation,
  type ScopedMemoryEvidenceSnapshot,
} from '../../services/memory/evidenceSnapshot';
import { closeMemoryDb } from '../../services/memory/database';
import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import { useChatStore } from '../../store/useChatStore';
import { resolveConversationPersonaForMode } from '../../engine/graph/conversation/modeTransitions';
import { resolveConversationWorkspaceTarget } from '../../services/conversationWorkspace/ownership';
import type { ConversationMode } from '../../types/conversation';
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

  await cancelScheduledIngestionDrain();
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

export function startNewForegroundScenarioConversation(params: {
  currentConversationId: string;
  providerId: string;
  model: string;
  systemPrompt: string;
  mode: ConversationMode;
  memoryStateBefore: ForegroundScenarioMemoryFinalState;
}): Readonly<{
  conversationId: string;
  lifecycle: ForegroundScenarioLifecycleSnapshot;
  memoryScope: MemoryScope;
  memoryState: ScopedMemoryEvidenceSnapshot;
}> {
  const store = useChatStore.getState();
  const previousConversation = store.conversations.find(
    (candidate) => candidate.id === params.currentConversationId,
  );
  if (!previousConversation) {
    throw new Error(`Conversation ${params.currentConversationId} is unavailable.`);
  }
  const previousConversationIdentity = JSON.stringify(previousConversation);
  const previousConversationMessageCount = previousConversation.messages.length;
  const conversationId = store.createConversation(
    params.providerId,
    params.systemPrompt,
    params.model,
    {
      mode: params.mode,
      personaId: resolveConversationPersonaForMode({ nextMode: params.mode }),
    },
  );
  if (conversationId === params.currentConversationId) {
    throw new Error('New-conversation boundary reused the previous conversation identity.');
  }
  const createdConversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  if (!createdConversation || createdConversation.messages.length !== 0) {
    throw new Error('New-conversation boundary did not create an empty product conversation.');
  }
  const preservedPreviousConversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.currentConversationId);
  if (
    !preservedPreviousConversation ||
    JSON.stringify(preservedPreviousConversation) !== previousConversationIdentity
  ) {
    throw new Error('New-conversation boundary changed the previous product conversation.');
  }
  const memoryScope = {
    memoryConversationId: resolveConversationWorkspaceTarget({
      conversationId,
      conversations: useChatStore.getState().conversations,
    }).workspaceConversationId,
    sourceThreadId: conversationId,
  };
  const previousScopeMemoryState = captureCompleteMemoryEvidenceForIsolatedEvaluation(
    params.memoryStateBefore.scope,
  );
  if (
    durableMemoryIdentity(previousScopeMemoryState) !==
    durableMemoryIdentity(params.memoryStateBefore)
  ) {
    throw new Error('Durable memory state changed while creating a fresh conversation.');
  }
  const memoryState = captureCompleteMemoryEvidenceForIsolatedEvaluation(memoryScope);
  return {
    conversationId,
    memoryScope,
    memoryState,
    lifecycle: {
      boundary: 'new_conversation',
      chatStore: 'fresh_conversation',
      memoryStore: 'shared_global',
      previousConversationMessageCount,
      newConversationInitialMessageCount: 0,
    },
  };
}
