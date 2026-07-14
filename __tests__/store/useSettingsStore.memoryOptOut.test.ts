jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../src/services/memory/memoryOptOutRetirement', () => ({
  retireActiveMemoryPublicationsBeforeOptOut: jest.fn(),
}));

import { retireActiveMemoryPublicationsBeforeOptOut } from '../../src/services/memory/memoryOptOutRetirement';
import { closeMemoryDb } from '../../src/services/memory/database';
import {
  getConsolidationState,
  markThreadDirtyForMemory,
  upsertState,
} from '../../src/services/memory/consolidatorScheduler';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { useChatStore } from '../helpers/chatStoreHarness';
import { resetSettingsStore } from '../helpers/settingsStoreFixtures';

const retireActivePublications = jest.mocked(retireActiveMemoryPublicationsBeforeOptOut);
const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useChatStore.setState({ conversations: [] });
  resetSettingsStore();
  retireActivePublications.mockReset();
  retireActivePublications.mockReturnValue({
    status: 'not_required',
    retiredSourceCount: 0,
    publicationWithdrawals: [],
  });
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function addPublicationReceipt(
  conversationId: string,
  sourceEndMessageId: string,
  disposition: null | 'enqueued',
): void {
  const store = useChatStore.getState();
  store.addMessage(conversationId, {
    id: `user-${sourceEndMessageId}`,
    role: 'user',
    content: 'طلب',
    timestamp: 10,
  });
  store.addMessage(conversationId, {
    id: sourceEndMessageId,
    role: 'assistant',
    content: '応答',
    timestamp: 11,
    assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
  });
  expect(
    store.transitionMessageMemoryPublication(conversationId, sourceEndMessageId, null).status,
  ).toBe('applied');
  if (disposition === 'enqueued') {
    expect(
      store.transitionMessageMemoryPublication(conversationId, sourceEndMessageId, 'enqueued')
        .status,
    ).toBe('applied');
  }
}

describe('settings memory opt-out transition', () => {
  it('fences unfinished publications exactly once before each false-to-true edge', () => {
    useSettingsStore.getState().setDisableLongTermMemory(true);
    expect(retireActivePublications).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().disableLongTermMemory).toBe(true);

    useSettingsStore.getState().setDisableLongTermMemory(true);
    expect(retireActivePublications).toHaveBeenCalledTimes(1);

    useSettingsStore.getState().setDisableLongTermMemory(false);
    expect(retireActivePublications).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().disableLongTermMemory).toBe(false);

    useSettingsStore.getState().setDisableLongTermMemory(true);
    expect(retireActivePublications).toHaveBeenCalledTimes(2);
  });

  it('keeps memory enabled when fence preparation fails', () => {
    retireActivePublications.mockImplementation(() => {
      throw new Error('forced_opt_out_retirement_failure');
    });

    expect(() => useSettingsStore.getState().setDisableLongTermMemory(true)).toThrow(
      'forced_opt_out_retirement_failure',
    );
    expect(useSettingsStore.getState().disableLongTermMemory).toBe(false);
  });

  it('settles open obligations and only withdraws enqueued work proven active', () => {
    const openConversationId = useChatStore.getState().createConversation('provider', 'model');
    const activeConversationId = useChatStore.getState().createConversation('provider', 'model');
    const completedConversationId = useChatStore.getState().createConversation('provider', 'model');
    addPublicationReceipt(openConversationId, 'assistant-open', null);
    addPublicationReceipt(activeConversationId, 'assistant-active', 'enqueued');
    addPublicationReceipt(completedConversationId, 'assistant-completed', 'enqueued');
    upsertState({
      threadId: completedConversationId,
      lastConsolidatedMessageId: 'assistant-completed',
      lastConsolidatedAt: 11,
      turnsSinceLast: 0,
      now: 11,
    });
    retireActivePublications.mockReturnValue({
      status: 'retired',
      retiredSourceCount: 3,
      publicationWithdrawals: [
        {
          sourceThreadId: activeConversationId,
          sourceEndMessageId: 'assistant-active',
        },
      ],
    });

    useSettingsStore.getState().setDisableLongTermMemory(true);

    const conversations = useChatStore.getState().conversations;
    const disposition = (conversationId: string, sourceEndMessageId: string) =>
      conversations
        .find(({ id }) => id === conversationId)
        ?.messages.find(({ id }) => id === sourceEndMessageId)?.memoryPublication?.disposition;
    expect(disposition(openConversationId, 'assistant-open')).toBe('opt_out');
    expect(disposition(activeConversationId, 'assistant-active')).toBe('withdrawn');
    expect(disposition(completedConversationId, 'assistant-completed')).toBe('enqueued');
    expect(getConsolidationState(openConversationId)?.lastConsolidatedMessageId).toBe(
      'assistant-open',
    );
    expect(getConsolidationState(activeConversationId)?.lastConsolidatedMessageId).toBe(
      'assistant-active',
    );
    expect(getConsolidationState(completedConversationId)?.lastConsolidatedMessageId).toBe(
      'assistant-completed',
    );
  });

  it('re-enables after excluded turns and admits only a new post-enable turn', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    addPublicationReceipt(conversationId, 'assistant-completed-before-opt-out', 'enqueued');
    upsertState({
      threadId: conversationId,
      lastConsolidatedMessageId: 'assistant-completed-before-opt-out',
      lastConsolidatedAt: 11,
      turnsSinceLast: 0,
      now: 11,
    });
    addPublicationReceipt(conversationId, 'assistant-withdrawn-at-opt-out', 'enqueued');
    retireActivePublications.mockReturnValue({
      status: 'retired',
      retiredSourceCount: 3,
      publicationWithdrawals: [
        {
          sourceThreadId: conversationId,
          sourceEndMessageId: 'assistant-withdrawn-at-opt-out',
        },
      ],
    });

    useSettingsStore.getState().setDisableLongTermMemory(true);
    addPublicationReceipt(conversationId, 'assistant-created-during-opt-out', null);
    expect(
      useChatStore
        .getState()
        .transitionMessageMemoryPublication(
          conversationId,
          'assistant-created-during-opt-out',
          'opt_out',
        ).status,
    ).toBe('applied');
    useSettingsStore.getState().setDisableLongTermMemory(false);
    addPublicationReceipt(conversationId, 'assistant-created-after-re-enable', null);

    const messages = useChatStore
      .getState()
      .conversations.find(({ id }) => id === conversationId)!.messages;
    const dirty = markThreadDirtyForMemory({
      threadId: conversationId,
      messages,
      now: 20,
    });

    expect(dirty).toMatchObject({ marked: true, newTurns: 2 });
    expect(getConsolidationState(conversationId)?.lastConsolidatedMessageId).toBe(
      'assistant-created-during-opt-out',
    );
    expect(
      messages.find(({ id }) => id === 'assistant-completed-before-opt-out')?.memoryPublication
        ?.disposition,
    ).toBe('enqueued');
    expect(
      messages.find(({ id }) => id === 'assistant-withdrawn-at-opt-out')?.memoryPublication
        ?.disposition,
    ).toBe('withdrawn');
  });

  it('applies the same fence-first contract to settings replacement', () => {
    useSettingsStore.getState().replaceAllSettings({ disableLongTermMemory: true });
    expect(retireActivePublications).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().disableLongTermMemory).toBe(true);

    useSettingsStore.getState().replaceAllSettings({ disableLongTermMemory: false });
    expect(retireActivePublications).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().disableLongTermMemory).toBe(false);
  });
});
