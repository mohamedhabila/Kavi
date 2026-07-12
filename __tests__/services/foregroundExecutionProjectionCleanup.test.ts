jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { useChatStore } from '../helpers/chatStoreHarness';
import {
  activateForegroundModelExecution,
  completeForegroundModelExecution,
  createForegroundModelExecution,
  modelProjectionOwnerForForegroundLease,
} from '../../src/services/executionJournal/foregroundModelExecutionJournal';
import { _resetForegroundModelExecutionProcessOwnershipForTests } from '../../src/services/executionJournal/foregroundModelExecutionProcessOwnership';
import { releaseStaleForegroundExecutionProjectionOwners } from '../../src/services/executionJournal/foregroundExecutionProjectionCleanup';
import { recoverInterruptedForegroundModelExecutions } from '../../src/services/executionJournal/foregroundModelExecutionRecovery';
import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { flushChatStorePersistenceNow } from '../../src/store/chatStorePersistence';
import { claimModelProjection } from '../../src/store/modelProjectionOwnership';
import { _resetThrottledStorageStateForTests } from '../../src/store/throttledStorage';

const DIGEST = 'a'.repeat(64);
const sqliteMock = jest.requireMock('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function journalOptions() {
  let sequence = 0;
  return {
    clock: () => 10,
    digest: async () => DIGEST,
    generateId: () => `id-${++sequence}`,
  };
}

async function seedOwnedGeneration(shouldActivate = true) {
  const conversationId = useChatStore.getState().createConversation('provider-1', 'Be helpful.');
  useChatStore.getState().addMessage(conversationId, {
    id: 'request-1',
    role: 'user',
    content: 'Do the work.',
    timestamp: 1,
  });
  const options = journalOptions();
  const created = await createForegroundModelExecution(
    {
      runId: 'run-1',
      conversationId,
      requestMessageId: 'request-1',
      assistantMessageId: 'assistant-1',
      requestState: {},
      modelState: {},
    },
    options,
  );
  const owner = modelProjectionOwnerForForegroundLease(created);
  expect(
    claimModelProjection({
      conversationId,
      owner,
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
      },
    }),
  ).toBe('claimed');
  const active = shouldActivate
    ? await activateForegroundModelExecution({ lease: created }, options)
    : created;
  return { active, conversationId, owner };
}

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
});

it('keeps an active owner but releases a terminal owner left by a crash', async () => {
  const seeded = await seedOwnedGeneration();

  await expect(releaseStaleForegroundExecutionProjectionOwners()).resolves.toBe(0);
  expect(
    useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === seeded.conversationId)
      ?.modelProjectionOwner,
  ).toEqual(seeded.owner);

  await completeForegroundModelExecution(
    {
      lease: seeded.active,
      status: 'failed',
      projectionMessageId: 'assistant-1',
      projectionState: { interrupted: true },
    },
    { ...journalOptions(), clock: () => 20 },
  );

  await expect(releaseStaleForegroundExecutionProjectionOwners()).resolves.toBe(1);
  expect(
    useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === seeded.conversationId)
      ?.modelProjectionOwner,
  ).toBeUndefined();
});

it.each(['terminal_review_pending', 'surfaced_worker_output_pending'])(
  'terminalizes a %s placeholder before releasing a reservation with no journal row',
  async (pendingFinishReason) => {
    const conversationId = useChatStore.getState().createConversation('provider-1', 'Be helpful.');
    useChatStore.getState().addMessage(conversationId, {
      id: `request-missing-${pendingFinishReason}`,
      role: 'user',
      content: 'Do the work.',
      timestamp: 1,
    });
    const owner = {
      surface: 'foreground' as const,
      runId: `missing-run-${pendingFinishReason}`,
      requestMessageId: `request-missing-${pendingFinishReason}`,
      assistantMessageId: `assistant-missing-${pendingFinishReason}`,
      controlEpoch: 0,
    };
    expect(
      claimModelProjection({
        conversationId,
        owner,
        assistantMessage: {
          id: `assistant-missing-${pendingFinishReason}`,
          role: 'assistant',
          content: 'Still working.',
          timestamp: 2,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'incomplete',
            finishReason: pendingFinishReason,
          },
        },
      }),
    ).toBe('claimed');

    await expect(releaseStaleForegroundExecutionProjectionOwners()).resolves.toBe(1);

    const conversation = useChatStore
      .getState()
      .conversations.find((candidate) => candidate.id === conversationId);
    expect(conversation?.modelProjectionOwner).toBeUndefined();
    expect(
      conversation?.messages.find(
        (message) => message.id === `assistant-missing-${pendingFinishReason}`,
      ),
    ).toEqual(
      expect.objectContaining({
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'app_restarted_before_start',
        }),
        isError: true,
      }),
    );
  },
);

it('does not misclassify a scheduler projection as a missing foreground journal reservation', async () => {
  const conversationId = useChatStore.getState().createConversation('provider-1', 'Be helpful.');
  useChatStore.getState().addMessage(conversationId, {
    id: 'scheduler-request',
    role: 'user',
    content: 'Scheduled work.',
    timestamp: 1,
  });
  const owner = {
    surface: 'scheduler' as const,
    runId: 'scheduler-run',
    requestMessageId: 'scheduler-request',
    assistantMessageId: 'scheduler-assistant',
    controlEpoch: 0,
  };
  expect(
    claimModelProjection({
      conversationId,
      owner,
      assistantMessage: {
        id: 'scheduler-assistant',
        role: 'assistant',
        content: 'Still working.',
        timestamp: 2,
      },
    }),
  ).toBe('claimed');

  await expect(releaseStaleForegroundExecutionProjectionOwners()).resolves.toBe(0);
  expect(
    useChatStore.getState().conversations.find((candidate) => candidate.id === conversationId)
      ?.modelProjectionOwner,
  ).toEqual(owner);
});

it('does not recover a live generation still owned by the current process', async () => {
  const seeded = await seedOwnedGeneration();

  await expect(recoverInterruptedForegroundModelExecutions()).resolves.toEqual([]);
  expect(
    getExecutionJournalDb().getFirstSync<{ status: string }>(
      'SELECT status FROM execution_runs WHERE id = ?',
      seeded.active.runId,
    ),
  ).toEqual({ status: 'running' });
  expect(
    useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === seeded.conversationId)
      ?.modelProjectionOwner,
  ).toEqual(seeded.owner);
});

it('does not recover a live queued generation during its claim and flush phase', async () => {
  const seeded = await seedOwnedGeneration(false);

  await expect(recoverInterruptedForegroundModelExecutions()).resolves.toEqual([]);
  expect(
    getExecutionJournalDb().getFirstSync<{ status: string }>(
      'SELECT status FROM execution_runs WHERE id = ?',
      seeded.active.runId,
    ),
  ).toEqual({ status: 'queued' });
  expect(
    useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === seeded.conversationId)
      ?.modelProjectionOwner,
  ).toEqual(seeded.owner);
});

it('CAS-recovers the exact owned projection and releases it only after journal completion', async () => {
  const seeded = await seedOwnedGeneration();
  _resetForegroundModelExecutionProcessOwnershipForTests();
  useChatStore.setState((state) => ({
    conversations: state.conversations.map((conversation) =>
      conversation.id !== seeded.conversationId
        ? conversation
        : {
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id !== 'assistant-1'
                ? message
                : {
                    ...message,
                    toolCalls: [
                      {
                        id: 'tool-1',
                        name: 'send_email',
                        arguments: '{}',
                        status: 'running' as const,
                      },
                    ],
                  },
            ),
          },
    ),
  }));

  await expect(recoverInterruptedForegroundModelExecutions()).resolves.toEqual([
    { kind: 'recovered', runId: seeded.active.runId, status: 'failed' },
  ]);
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === seeded.conversationId);
  expect(conversation?.modelProjectionOwner).toBeUndefined();
  expect(conversation?.messages.find((message) => message.id === 'assistant-1')).toEqual(
    expect.objectContaining({
      content: 'Response interrupted because the app restarted before completion.',
      assistantMetadata: expect.objectContaining({ finishReason: 'app_restarted' }),
      toolCalls: [expect.objectContaining({ status: 'failed' })],
    }),
  );
  expect(
    getExecutionJournalDb().getFirstSync<{ status: string }>(
      'SELECT status FROM execution_runs WHERE id = ?',
      seeded.active.runId,
    ),
  ).toEqual({ status: 'failed' });
});

it('recovers a flushed projection after fresh hydration and durably persists the repair', async () => {
  const seeded = await seedOwnedGeneration();
  useChatStore.setState((state) => ({
    conversations: state.conversations.map((conversation) =>
      conversation.id !== seeded.conversationId
        ? conversation
        : {
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id !== 'assistant-1'
                ? message
                : {
                    ...message,
                    toolCalls: [
                      {
                        id: 'tool-1',
                        name: 'send_email',
                        arguments: '{}',
                        status: 'running' as const,
                      },
                    ],
                  },
            ),
          },
    ),
  }));
  await flushChatStorePersistenceNow();

  closeExecutionJournalDb();
  _resetForegroundModelExecutionProcessOwnershipForTests();
  useChatStore.setState({ conversations: [], activeConversationId: null });
  _resetThrottledStorageStateForTests();
  await useChatStore.persist.rehydrate();

  expect(
    useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === seeded.conversationId)
      ?.modelProjectionOwner,
  ).toEqual(seeded.owner);
  await expect(recoverInterruptedForegroundModelExecutions()).resolves.toEqual([
    { kind: 'recovered', runId: seeded.active.runId, status: 'failed' },
  ]);

  useChatStore.setState({ conversations: [], activeConversationId: null });
  _resetThrottledStorageStateForTests();
  await useChatStore.persist.rehydrate();

  const recovered = useChatStore
    .getState()
    .conversations.find((conversation) => conversation.id === seeded.conversationId);
  expect(recovered?.modelProjectionOwner).toBeUndefined();
  expect(recovered?.messages.find((message) => message.id === 'assistant-1')).toEqual(
    expect.objectContaining({
      content: 'Response interrupted because the app restarted before completion.',
      assistantMetadata: expect.objectContaining({ finishReason: 'app_restarted' }),
      toolCalls: [expect.objectContaining({ status: 'failed' })],
    }),
  );
  expect(
    getExecutionJournalDb().getFirstSync<{ status: string }>(
      'SELECT status FROM execution_runs WHERE id = ?',
      seeded.active.runId,
    ),
  ).toEqual({ status: 'failed' });
});

it('terminalizes permanently orphaned active rows so later recovery sweeps do not rescan them', async () => {
  const seeded = await seedOwnedGeneration();
  _resetForegroundModelExecutionProcessOwnershipForTests();
  useChatStore.setState((state) => ({
    conversations: state.conversations.map((conversation) =>
      conversation.id !== seeded.conversationId
        ? conversation
        : {
            ...conversation,
            messages: conversation.messages.filter((message) => message.id !== 'request-1'),
          },
    ),
  }));

  await expect(recoverInterruptedForegroundModelExecutions()).resolves.toEqual([
    { kind: 'recovered', runId: seeded.active.runId, status: 'failed' },
  ]);
  await expect(recoverInterruptedForegroundModelExecutions()).resolves.toEqual([]);
  expect(
    getExecutionJournalDb().getFirstSync<{ status: string }>(
      'SELECT status FROM execution_runs WHERE id = ?',
      seeded.active.runId,
    ),
  ).toEqual({ status: 'failed' });
});
