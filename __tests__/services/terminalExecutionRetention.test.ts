jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import {
  createExecutionRun,
  transitionExecutionRun,
} from '../../src/services/executionJournal/mutations';
import {
  maintainAllTerminalExecutionRetention,
  maintainTerminalExecutionRetention,
} from '../../src/services/executionJournal/terminalExecutionRetention';
import {
  executionCheckpointRecord,
  executionRunRecord,
} from '../helpers/executionJournalMutationFixtures';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests: () => void;
};

type SeedStatus = 'queued' | 'blocked' | 'ambiguous' | 'succeeded' | 'failed' | 'cancelled';

function seedExternalRun(id: string, status: SeedStatus, createdAt: number): void {
  const run = executionRunRecord({
    id,
    conversationId: 'conversation-1',
    threadId: 'conversation-1',
    taskId: 'agent-run-1',
    goalId: null,
    requestMessageId: `message-${id}`,
    durabilityClass: 'external_durable_operation',
    requestedCapability: 'monitor',
    executionSurface: 'external_api',
    status: 'queued',
    resumeStrategy: 'reconcile_first',
    nextRetryPolicy: 'monitor_only',
    createdAt,
    updatedAt: createdAt,
  });
  createExecutionRun({
    run,
    initialCheckpoint: executionCheckpointRecord(run, {
      id: `checkpoint-${id}`,
      stateRefId: `state-${id}`,
    }),
  });
  if (status === 'queued') return;
  if (status === 'blocked' || status === 'failed' || status === 'cancelled') {
    transitionExecutionRun({
      runId: id,
      expectedStatus: 'queued',
      nextStatus: status,
      expectedControlEpoch: 0,
      nextControlEpoch: 0,
      occurredAt: createdAt + 1,
    });
    return;
  }
  transitionExecutionRun({
    runId: id,
    expectedStatus: 'queued',
    nextStatus: 'running',
    expectedControlEpoch: 0,
    nextControlEpoch: 0,
    occurredAt: createdAt + 1,
  });
  transitionExecutionRun({
    runId: id,
    expectedStatus: 'running',
    nextStatus: status,
    expectedControlEpoch: 0,
    nextControlEpoch: 0,
    occurredAt: createdAt + 2,
  });
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

describe('generic terminal execution retention', () => {
  it('prunes only selected terminal rows and preserves active, ambiguous, and attention rows', () => {
    seedExternalRun('external-old', 'succeeded', 10);
    seedExternalRun('external-recent', 'failed', 900);
    seedExternalRun('external-active', 'queued', 20);
    seedExternalRun('external-ambiguous', 'ambiguous', 30);
    seedExternalRun('external-attention', 'blocked', 40);
    getExecutionJournalDb().runSync(
      `INSERT INTO execution_recovery_attention (
         run_id, control_epoch, source_generation_updated_at, reason, created_at
       ) VALUES (?, ?, ?, ?, ?)`,
      'external-attention',
      0,
      41,
      'recovery_blocked',
      42,
    );
    const foreground = executionRunRecord({
      id: 'foreground-old',
      durabilityClass: 'foreground_interactive',
      executionSurface: 'model',
      status: 'queued',
      createdAt: 10,
      updatedAt: 10,
      terminalAt: null,
    });
    createExecutionRun({
      run: foreground,
      initialCheckpoint: executionCheckpointRecord(foreground, {
        id: 'checkpoint-foreground-old',
        stateRefId: 'state-foreground-old',
      }),
    });
    transitionExecutionRun({
      runId: foreground.id,
      expectedStatus: 'queued',
      nextStatus: 'failed',
      expectedControlEpoch: 0,
      nextControlEpoch: 0,
      occurredAt: 11,
    });

    expect(
      maintainTerminalExecutionRetention({
        now: 1_000,
        durabilityClass: 'external_durable_operation',
        maxAgeMs: 100,
        maxRetained: 10,
        limit: 10,
      }),
    ).toBe(1);

    const remaining = getExecutionJournalDb()
      .getAllSync<{ id: string }>('SELECT id FROM execution_runs ORDER BY id ASC')
      .map((row) => row.id);
    expect(remaining).not.toContain('external-old');
    expect(remaining).toEqual(
      expect.arrayContaining([
        'external-recent',
        'external-active',
        'external-ambiguous',
        'external-attention',
        'foreground-old',
      ]),
    );
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT reason FROM execution_recovery_attention WHERE run_id = 'external-attention'`,
      ),
    ).toEqual({ reason: 'recovery_blocked' });
  });

  it('drains aged and overflow rows through bounded batches', () => {
    seedExternalRun('external-1', 'succeeded', 10);
    seedExternalRun('external-2', 'failed', 20);
    seedExternalRun('external-3', 'cancelled', 30);
    seedExternalRun('external-4', 'succeeded', 40);

    expect(
      maintainAllTerminalExecutionRetention({
        now: 100,
        durabilityClass: 'external_durable_operation',
        maxAgeMs: 1_000,
        maxRetained: 1,
        limit: 1,
      }),
    ).toBe(3);
    expect(
      getExecutionJournalDb().getAllSync<{ id: string }>(
        `SELECT id FROM execution_runs
         WHERE durability_class = 'external_durable_operation'
         ORDER BY terminal_at ASC`,
      ),
    ).toEqual([{ id: 'external-4' }]);
  });

  it('rejects unbounded and malformed policies before opening a transaction', () => {
    expect(() =>
      maintainTerminalExecutionRetention({
        now: -1,
        durabilityClass: 'external_durable_operation',
      }),
    ).toThrow('execution_journal_retention_invalid_clock');
    expect(() =>
      maintainTerminalExecutionRetention({
        now: 1,
        durabilityClass: 'external_durable_operation',
        limit: 1_001,
      }),
    ).toThrow('execution_journal_retention_invalid_limit');
    expect(() =>
      maintainTerminalExecutionRetention({
        now: 1,
        durabilityClass: 'invalid' as never,
      }),
    ).toThrow('execution_journal_retention_invalid_durability_class');
  });
});
