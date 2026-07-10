jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { useChatStore } from '../helpers/chatStoreHarness';
import {
  activateForegroundModelExecution,
  completeForegroundModelExecution,
  createForegroundModelExecution,
  foregroundModelProjectionOwnerForLease,
} from '../../src/services/executionJournal/foregroundModelExecutionJournal';
import { releaseStaleForegroundModelProjectionOwners } from '../../src/services/executionJournal/foregroundModelProjectionCleanup';
import { recoverInterruptedForegroundModelExecutions } from '../../src/services/executionJournal/foregroundModelExecutionRecovery';
import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { claimForegroundModelProjection } from '../../src/store/foregroundModelProjectionOwnership';

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

async function seedOwnedGeneration() {
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
      conversationId,
      requestMessageId: 'request-1',
      assistantMessageId: 'assistant-1',
      requestState: {},
      modelState: {},
    },
    options,
  );
  const owner = foregroundModelProjectionOwnerForLease(created);
  expect(
    claimForegroundModelProjection({
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
  const active = await activateForegroundModelExecution({ lease: created }, options);
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

  await expect(releaseStaleForegroundModelProjectionOwners()).resolves.toBe(0);
  expect(
    useChatStore.getState().conversations.find((conversation) =>
      conversation.id === seeded.conversationId
    )?.foregroundModelProjectionOwner,
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

  await expect(releaseStaleForegroundModelProjectionOwners()).resolves.toBe(1);
  expect(
    useChatStore.getState().conversations.find((conversation) =>
      conversation.id === seeded.conversationId
    )?.foregroundModelProjectionOwner,
  ).toBeUndefined();
});

it('CAS-recovers the exact owned projection and releases it only after journal completion', async () => {
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

  await expect(recoverInterruptedForegroundModelExecutions()).resolves.toEqual([
    { kind: 'recovered', runId: seeded.active.runId, status: 'failed' },
  ]);
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === seeded.conversationId);
  expect(conversation?.foregroundModelProjectionOwner).toBeUndefined();
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

it('terminalizes permanently orphaned active rows so later recovery sweeps do not rescan them', async () => {
  const seeded = await seedOwnedGeneration();
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
