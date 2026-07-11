jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  activateForegroundModelExecution,
  completeForegroundModelExecution,
  createForegroundModelExecution,
} from '../../src/services/executionJournal/foregroundModelExecutionJournal';
import {
  maintainForegroundModelExecutionRetention,
} from '../../src/services/executionJournal/foregroundModelExecutionRetention';
import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';

const DIGEST = 'a'.repeat(64);
const sqliteMock = jest.requireMock('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function options(prefix: string, clock: number) {
  let sequence = 0;
  return {
    clock: () => clock,
    digest: async () => DIGEST,
    generateId: () => `${prefix}-${++sequence}`,
  };
}

async function seedTerminal(prefix: string, createdAt: number) {
  const journalOptions = options(prefix, createdAt);
  const created = await createForegroundModelExecution(
    {
      conversationId: `conversation-${prefix}`,
      requestMessageId: `request-${prefix}`,
      assistantMessageId: `assistant-${prefix}`,
      requestState: {},
      modelState: {},
    },
    journalOptions,
  );
  const execution = await activateForegroundModelExecution(
    { lease: created },
    journalOptions,
  );
  await completeForegroundModelExecution(
    {
      lease: execution,
      status: 'succeeded',
      projectionMessageId: `assistant-${prefix}`,
      projectionState: { complete: true },
    },
    options(`terminal-${prefix}`, createdAt + 1),
  );
  return execution.runId;
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

it('removes aged terminal foreground rows without touching active work', async () => {
  const oldRunId = await seedTerminal('old', 10);
  const recentRunId = await seedTerminal('recent', 900);
  const active = await createForegroundModelExecution(
    {
      conversationId: 'conversation-active',
      requestMessageId: 'request-active',
      assistantMessageId: 'assistant-active',
      requestState: {},
      modelState: {},
    },
    options('active', 20),
  );

  expect(
    maintainForegroundModelExecutionRetention({
      now: 1_000,
      maxAgeMs: 100,
      maxRetained: 10,
      limit: 10,
    }),
  ).toBe(1);
  const remaining = getExecutionJournalDb()
    .getAllSync<{ id: string }>('SELECT id FROM execution_runs ORDER BY id ASC')
    .map((row) => row.id);
  expect(remaining).toEqual(expect.arrayContaining([recentRunId, active.runId]));
  expect(remaining).not.toContain(oldRunId);
});

it('caps recent terminal history by deleting only the oldest overflow', async () => {
  const first = await seedTerminal('first', 100);
  const second = await seedTerminal('second', 200);
  const third = await seedTerminal('third', 300);
  const fourth = await seedTerminal('fourth', 400);

  expect(
    maintainForegroundModelExecutionRetention({
      now: 500,
      maxAgeMs: 10_000,
      maxRetained: 2,
      limit: 10,
    }),
  ).toBe(2);
  const remaining = getExecutionJournalDb()
    .getAllSync<{ id: string }>(
      `SELECT id FROM execution_runs
       WHERE status IN ('succeeded', 'failed', 'cancelled')
       ORDER BY terminal_at ASC`,
    )
    .map((row) => row.id);
  expect(remaining).toEqual([third, fourth]);
  expect(remaining).not.toEqual(expect.arrayContaining([first, second]));
});

it('bounds each cleanup pass and rejects invalid policy inputs', async () => {
  await seedTerminal('first', 10);
  await seedTerminal('second', 20);
  await seedTerminal('third', 30);

  expect(
    maintainForegroundModelExecutionRetention({
      now: 1_000,
      maxAgeMs: 100,
      maxRetained: 10,
      limit: 2,
    }),
  ).toBe(2);
  expect(() =>
    maintainForegroundModelExecutionRetention({ now: -1 }),
  ).toThrow('foreground_model_retention_invalid_clock');
  expect(() =>
    maintainForegroundModelExecutionRetention({ now: 1_000, maxRetained: 0 }),
  ).toThrow('foreground_model_retention_invalid_max_retained');
});

it('converges across separately bounded foreground retention passes', async () => {
  await seedTerminal('one', 10);
  await seedTerminal('two', 20);
  await seedTerminal('three', 30);

  expect(
    maintainForegroundModelExecutionRetention({
      now: 40,
      maxAgeMs: 1_000,
      maxRetained: 1,
      limit: 1,
    }),
  ).toBe(1);
  expect(
    maintainForegroundModelExecutionRetention({
      now: 40,
      maxAgeMs: 1_000,
      maxRetained: 1,
      limit: 1,
    }),
  ).toBe(1);
  expect(
    getExecutionJournalDb().getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM execution_runs
       WHERE status IN ('succeeded', 'failed', 'cancelled')`,
    )?.count,
  ).toBe(1);
});
