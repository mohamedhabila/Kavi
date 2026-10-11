jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});

import { STORAGE_KEYS } from '../../src/constants/storage';
import {
  relaunchForegroundScenarioApp,
  startNewForegroundScenarioConversation,
} from '../../src/acceptance/e2eAgent/foregroundScenarioLifecycle';
import { captureForegroundScenarioMemoryItems } from '../../src/acceptance/e2eAgent/foregroundScenarioMemoryItemsEvidence';
import { addMemoryItem, searchMemoryItems } from '../../src/services/memory/core/memoryItemsStore';
import { resetMemoryCoreSchemaCacheForTests } from '../../src/services/memory/core/memorySchema';
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
const mockScheduleMemoryExtraction = jest.fn();
jest.mock('../../src/services/memory/core/memoryExtractionWorker', () => ({
  cancelMemoryExtraction: jest.fn(),
  scheduleMemoryExtraction: (...args: unknown[]) => mockScheduleMemoryExtraction(...args),
}));

function makeConversation(): Conversation {
  return {
    id: 'relaunch-conversation',
    title: 'Relaunch continuity',
    messages: [
      { id: 'user-before-relaunch', role: 'user', content: 'Remember this.', timestamp: 10 },
      {
        id: 'assistant-before-relaunch',
        role: 'assistant',
        content: 'Remembered.',
        timestamp: 11,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      },
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
  resetMemoryCoreSchemaCacheForTests();
  mockScheduleMemoryExtraction.mockClear();

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

it('rehydrates the production chat store, reopens memory and catches up on the closed turn', async () => {
  addMemoryItem({
    text: 'Profile token RELAUNCH-PROFILE-73',
    scope: 'conversation',
    conversationId: 'relaunch-conversation',
    now: 20,
  });

  await expect(
    relaunchForegroundScenarioApp({ conversationId: 'relaunch-conversation' }),
  ).resolves.toEqual({
    lifecycle: {
      boundary: 'app_relaunch',
      chatStore: 'rehydrated',
      memoryStore: 'reopened',
    },
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
  const memory = captureForegroundScenarioMemoryItems();
  expect(memory.items.map((item) => item.text)).toEqual(['Profile token RELAUNCH-PROFILE-73']);
  expect(memory.indexedTurnCount).toBe(1);
  expect(mockScheduleMemoryExtraction).toHaveBeenCalledWith(
    'relaunch-conversation',
    'assistant-before-relaunch',
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

it('creates a fresh product conversation while preserving global memory', () => {
  addMemoryItem({
    text: 'Default meeting duration is 45 minutes',
    conversationId: 'relaunch-conversation',
    now: 13,
  });

  const transition = startNewForegroundScenarioConversation({
    currentConversationId: 'relaunch-conversation',
    providerId: 'provider-relaunch',
    model: 'model-relaunch',
    systemPrompt: 'Be helpful.',
    mode: 'chitchat',
  });

  expect(transition.conversationId).not.toBe('relaunch-conversation');
  expect(transition.lifecycle).toEqual({
    boundary: 'new_conversation',
    chatStore: 'fresh_conversation',
    memoryStore: 'shared_global',
    previousConversationMessageCount: 2,
    newConversationInitialMessageCount: 0,
  });
  expect(
    searchMemoryItems({
      query: 'meeting duration',
      visibility: { conversationId: transition.conversationId },
      limit: 5,
      includeSensitive: false,
    }).map((item) => item.text),
  ).toEqual(['Default meeting duration is 45 minutes']);
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
