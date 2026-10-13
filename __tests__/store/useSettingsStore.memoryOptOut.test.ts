jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

const mockCancelMemoryExtraction = jest.fn();
jest.mock('../../src/services/memory/core/memoryExtractionWorker', () => ({
  bindConversationFocus: jest.fn(),
  cancelMemoryExtraction: (...args: unknown[]) => mockCancelMemoryExtraction(...args),
  scheduleMemoryExtraction: jest.fn(),
}));

import { closeMemoryDb } from '../../src/services/memory/database';
import {
  catchUpMemoryCapture,
  publishConversationTurnMemory,
} from '../../src/services/memory/core/memoryCapture';
import { resetMemoryCoreSchemaCacheForTests } from '../../src/services/memory/core/memorySchema';
import { searchMemoryTurns } from '../../src/services/memory/core/memoryTurnsStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { useChatStore } from '../helpers/chatStoreHarness';
import { resetSettingsStore } from '../helpers/settingsStoreFixtures';
import { addConversation } from '../helpers/chatConversationFixtures';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
  useChatStore.setState({ conversations: [] });
  resetSettingsStore();
  mockCancelMemoryExtraction.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  closeMemoryDb();
});

function addClosedTurn(conversationId: string, id: string, timestamp: number): void {
  const store = useChatStore.getState();
  store.addMessage(conversationId, {
    id: `user-${id}`,
    role: 'user',
    content: `طلب ${id}`,
    timestamp,
  });
  store.addMessage(conversationId, {
    id,
    role: 'assistant',
    content: `返信します ${id}`,
    timestamp: timestamp + 1,
    assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
  });
}

function indexedTurnIds(): string[] {
  return searchMemoryTurns({ query: '返信します', limit: 10, includeSensitive: true })
    .map((turn) => turn.userMessageId)
    .sort();
}

describe('settings memory opt-out transition', () => {
  it('turning memory off cancels background extraction', () => {
    useSettingsStore.getState().setDisableLongTermMemory(true);

    expect(useSettingsStore.getState().disableLongTermMemory).toBe(true);
    expect(mockCancelMemoryExtraction).toHaveBeenCalledTimes(1);

    useSettingsStore.getState().setDisableLongTermMemory(true);
    expect(mockCancelMemoryExtraction).toHaveBeenCalledTimes(1);
  });

  it('never captures what was said while memory was off', () => {
    const conversationId = addConversation('provider', 'model');
    addClosedTurn(conversationId, 'before-opt-out', 10);
    publishConversationTurnMemory(conversationId, 'before-opt-out');

    useSettingsStore.getState().setDisableLongTermMemory(true);
    addClosedTurn(conversationId, 'during-opt-out', 20);
    publishConversationTurnMemory(conversationId, 'during-opt-out');
    useSettingsStore.getState().setDisableLongTermMemory(false);
    catchUpMemoryCapture(useChatStore.getState().conversations);

    expect(indexedTurnIds()).toEqual(['user-before-opt-out']);

    addClosedTurn(conversationId, 'after-opt-in', 30);
    publishConversationTurnMemory(conversationId, 'after-opt-in');

    expect(indexedTurnIds()).toEqual(['user-after-opt-in', 'user-before-opt-out']);
  });

  it('applies the same transitions to settings replacement', () => {
    const conversationId = addConversation('provider', 'model');

    useSettingsStore.getState().replaceAllSettings({ disableLongTermMemory: true });
    expect(useSettingsStore.getState().disableLongTermMemory).toBe(true);
    expect(mockCancelMemoryExtraction).toHaveBeenCalledTimes(1);

    addClosedTurn(conversationId, 'during-opt-out', 20);
    useSettingsStore.getState().replaceAllSettings({ disableLongTermMemory: false });
    catchUpMemoryCapture(useChatStore.getState().conversations);

    expect(useSettingsStore.getState().disableLongTermMemory).toBe(false);
    expect(indexedTurnIds()).toEqual([]);
  });
});
