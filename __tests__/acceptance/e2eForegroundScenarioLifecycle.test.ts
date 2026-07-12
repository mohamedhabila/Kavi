jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { STORAGE_KEYS } from '../../src/constants/storage';
import {
  relaunchForegroundScenarioApp,
  startNewForegroundScenarioConversation,
} from '../../src/acceptance/e2eAgent/foregroundScenarioLifecycle';
import {
  captureCompleteMemoryEvidenceForIsolatedEvaluation,
  captureScopedMemoryEvidence,
} from '../../src/services/memory/evidenceSnapshot';
import { upsertEntity } from '../../src/services/memory/entities';
import { recordThreadLocalEpisode } from '../../src/services/memory/episodes/mutations';
import { recordFact } from '../../src/services/memory/facts/mutations';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb } from '../../src/services/memory/database';
import { flushChatStorePersistenceNow } from '../../src/store/chatStorePersistence';
import {
  _getStorageFileUris,
  _resetThrottledStorageStateForTests,
  flushPendingStorageWrites,
  throttledAsyncStorage,
} from '../../src/store/throttledStorage';
import { useChatStore } from '../../src/store/useChatStore';
import type { Conversation } from '../../src/types/conversation';

const expoFileSystemMock = jest.requireMock('expo-file-system') as {
  __getStore: () => Record<string, string | Uint8Array>;
  __resetStore: () => void;
};
const expoSqlite = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests: () => void;
};

function makeConversation(): Conversation {
  return {
    id: 'relaunch-conversation',
    title: 'Relaunch continuity',
    messages: [
      { id: 'user-before-relaunch', role: 'user', content: 'Remember this.', timestamp: 10 },
      { id: 'assistant-before-relaunch', role: 'assistant', content: 'Remembered.', timestamp: 11 },
    ],
    providerId: 'provider-relaunch',
    modelOverride: 'model-relaunch',
    systemPrompt: 'Be helpful.',
    createdAt: 1,
    updatedAt: 11,
    mode: 'chitchat',
    personaId: 'default',
  };
}

function readPersistedConversationIds(): string[] {
  const { primary } = _getStorageFileUris(STORAGE_KEYS.CONVERSATIONS);
  const raw = expoFileSystemMock.__getStore()[primary];
  if (typeof raw !== 'string') return [];
  const envelope = JSON.parse(raw) as { payload?: unknown };
  if (typeof envelope.payload !== 'string') return [];
  const parsed = JSON.parse(envelope.payload) as { state?: { conversations?: Conversation[] } };
  return parsed.state?.conversations?.map((conversation) => conversation.id) ?? [];
}

beforeEach(async () => {
  await flushPendingStorageWrites();
  _resetThrottledStorageStateForTests();
  expoFileSystemMock.__resetStore();
  await throttledAsyncStorage.removeItem(STORAGE_KEYS.CONVERSATIONS);
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();

  useChatStore.setState({
    conversations: [makeConversation()],
    activeConversationId: 'relaunch-conversation',
    isLoading: false,
  });
  await flushChatStorePersistenceNow();
});

afterEach(async () => {
  await flushPendingStorageWrites();
  _resetThrottledStorageStateForTests();
  closeMemoryDb();
});

it('rehydrates the production chat store and reopens unchanged durable memory', async () => {
  const user = upsertEntity({ name: 'user', type: 'self', now: 19 });
  recordFact({
    subjectId: user.id,
    predicate: 'profile_token',
    objectText: 'RELAUNCH-PROFILE-73',
    scope: 'conversation',
    originConversationId: 'relaunch-conversation',
    originThreadId: 'relaunch-conversation',
    now: 20,
  });
  const scope = {
    memoryConversationId: 'relaunch-conversation',
    sourceThreadId: 'relaunch-conversation',
  };
  const memoryStateBefore = captureScopedMemoryEvidence(scope);

  await expect(
    relaunchForegroundScenarioApp({
      conversationId: 'relaunch-conversation',
      memoryScope: scope,
      memoryStateBefore,
    }),
  ).resolves.toEqual({
    boundary: 'app_relaunch',
    chatStore: 'rehydrated',
    memoryStore: 'reopened',
  });

  expect(useChatStore.getState()).toMatchObject({
    activeConversationId: 'relaunch-conversation',
    conversations: [
      expect.objectContaining({
        id: 'relaunch-conversation',
        messages: expect.arrayContaining([
          expect.objectContaining({ id: 'assistant-before-relaunch' }),
        ]),
      }),
    ],
  });
  expect(captureScopedMemoryEvidence(scope).facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ predicate: 'profile_token', objectText: 'RELAUNCH-PROFILE-73' }),
    ]),
  );
  expect(readPersistedConversationIds()).toEqual(['relaunch-conversation']);

  useChatStore.getState().addMessage('relaunch-conversation', {
    id: 'user-after-relaunch',
    role: 'user',
    content: 'Continue.',
    timestamp: 30,
  });
  await flushChatStorePersistenceNow();
  expect(readPersistedConversationIds()).toEqual(['relaunch-conversation']);
});

it('creates a fresh product conversation while preserving owner-global memory', () => {
  const user = upsertEntity({ name: 'user', type: 'self', now: 12 });
  recordFact({
    subjectId: user.id,
    predicate: 'default_meeting_duration_minutes',
    objectText: '45',
    scope: 'global',
    now: 13,
  });
  recordThreadLocalEpisode({
    conversationId: 'relaunch-conversation',
    threadId: 'relaunch-conversation',
    summary: 'The first conversation contains scoped evidence.',
    messageIds: ['user-before-relaunch', 'assistant-before-relaunch'],
    sourceStartMessageId: 'user-before-relaunch',
    sourceEndMessageId: 'assistant-before-relaunch',
    now: 14,
  });
  const initialScope = {
    memoryConversationId: 'relaunch-conversation',
    sourceThreadId: 'relaunch-conversation',
  };
  const transition = startNewForegroundScenarioConversation({
    currentConversationId: 'relaunch-conversation',
    providerId: 'provider-relaunch',
    model: 'model-relaunch',
    systemPrompt: 'Be helpful.',
    mode: 'chitchat',
    memoryStateBefore: captureCompleteMemoryEvidenceForIsolatedEvaluation(initialScope),
  });

  expect(transition.conversationId).not.toBe('relaunch-conversation');
  expect(transition.lifecycle).toEqual({
    boundary: 'new_conversation',
    chatStore: 'fresh_conversation',
    memoryStore: 'shared_global',
    previousConversationMessageCount: 2,
    newConversationInitialMessageCount: 0,
  });
  expect(transition.memoryState.facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        subject: 'user',
        predicate: 'default_meeting_duration_minutes',
        objectText: '45',
        scope: 'global',
      }),
    ]),
  );
  expect(transition.memoryState.episodes).toEqual([]);
  expect(captureCompleteMemoryEvidenceForIsolatedEvaluation(initialScope).episodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ summary: 'The first conversation contains scoped evidence.' }),
    ]),
  );
  expect(
    useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === transition.conversationId)
      ?.messages,
  ).toEqual([]);
  expect(
    useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === 'relaunch-conversation')?.messages,
  ).toHaveLength(2);
});
