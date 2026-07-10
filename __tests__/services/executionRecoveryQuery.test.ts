jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('expo-crypto', () => {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash('sha256').update(value, 'utf8').digest('hex'),
  };
});

import type * as SQLite from 'expo-sqlite';
import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import {
  appendExecutionCheckpoint,
  transitionExecutionRun,
} from '../../src/services/executionJournal/mutations';
import { insertRun } from '../../src/services/executionJournal/mutationStore';
import {
  EXECUTION_RECOVERY_QUERY_BLOCK_REASONS,
  queryExecutionRecovery,
  type ExecutionRecoveryQueryBlockReason,
  type ExecutionRecoveryQueryResult,
} from '../../src/services/executionJournal/recoveryQuery';
import { deleteRetainedTerminalExecutionRun } from '../../src/services/executionJournal/retention';
import { DIGEST_C, seedExecutionRun } from '../helpers/executionJournalMutationFixtures';
import {
  insertRecoveryEffect,
  insertRecoveryHandle,
  seedOrderedRecoveryGraph,
  seedOwnedRecoveryRun,
} from '../helpers/executionRecoveryQueryFixtures';
import { recoveryEffect, recoveryHandle, recoveryRun } from '../helpers/executionRecoveryFixtures';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  openDatabaseSync: (name: string) => SQLite.SQLiteDatabase;
  __resetExpoSqliteForTests: () => void;
};

const blockedResult = (
  runId: string,
  reason: ExecutionRecoveryQueryBlockReason,
): ExecutionRecoveryQueryResult => ({
  kind: 'query_blocked',
  runId,
  generation: null,
  reason,
});

function resetJournal(): void {
  try {
    closeExecutionJournalDb();
  } catch {
    // A corruption case may already have invalidated the handle.
  }
  sqliteMock.__resetExpoSqliteForTests();
}

beforeEach(resetJournal);
afterEach(resetJournal);

describe('execution recovery query contract', () => {
  it('returns only a closed generation and planner command from a decoded snapshot', async () => {
    seedExecutionRun();

    const result = await queryExecutionRecovery({ runId: 'run-1' });

    expect(result).toEqual({
      kind: 'recovery_plan',
      runId: 'run-1',
      generation: {
        controlEpoch: 0,
        updatedAt: 10,
        snapshotDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      command: {
        kind: 'resume_model_step',
        runId: 'run-1',
        checkpointId: 'checkpoint-0',
        controlEpoch: 0,
        stateRefId: 'state-0',
        stateDigest: DIGEST_C,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /conversation-1|thread-1|message-1|inputDigest|modelConfigDigest|requestDigest/u,
    );
  });

  it('uses a read transaction without journal mutations', async () => {
    seedExecutionRun();
    const database = getExecutionJournalDb();
    const countsBefore = database.getFirstSync<{ runs: number; checkpoints: number }>(
      `SELECT
         (SELECT count(*) FROM execution_runs) AS runs,
         (SELECT count(*) FROM execution_checkpoints) AS checkpoints`,
    );
    const runSpy = jest.spyOn(database, 'runSync');
    const execSpy = jest.spyOn(database, 'execSync');

    const result = await queryExecutionRecovery({ runId: 'run-1' });

    expect(result.kind).toBe('recovery_plan');
    expect(runSpy).not.toHaveBeenCalled();
    expect(execSpy.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT']);
    expect(
      database.getFirstSync<{ runs: number; checkpoints: number }>(
        `SELECT
           (SELECT count(*) FROM execution_runs) AS runs,
           (SELECT count(*) FROM execution_checkpoints) AS checkpoints`,
      ),
    ).toEqual(countsBefore);
  });

  it('rejects a changed full snapshot even when epoch and timestamp are unchanged', async () => {
    seedExecutionRun();
    const first = await queryExecutionRecovery({ runId: 'run-1' });
    expect(first.kind).toBe('recovery_plan');
    if (first.kind !== 'recovery_plan') throw new Error('expected recovery plan');
    expect(
      await queryExecutionRecovery({
        runId: 'run-1',
        expectedGeneration: first.generation,
      }),
    ).toEqual(first);

    appendExecutionCheckpoint({
      id: 'checkpoint-same-time',
      runId: 'run-1',
      expectedControlEpoch: 0,
      taskId: 'task-1',
      goalId: 'goal-1',
      phase: 'work',
      boundary: 'before_model',
      stateRefId: 'state-same-time',
      stateDigest: DIGEST_C,
      resumeStrategy: 'replay_safe',
      approvalState: 'not_required',
      permissionState: 'granted',
      createdAt: 10,
    });

    expect(
      await queryExecutionRecovery({
        runId: 'run-1',
        expectedGeneration: first.generation,
      }),
    ).toEqual(blockedResult('run-1', 'generation_mismatch'));
    const current = await queryExecutionRecovery({ runId: 'run-1' });
    expect(current).toEqual(
      expect.objectContaining({
        kind: 'recovery_plan',
        generation: expect.objectContaining({ controlEpoch: 0, updatedAt: 10 }),
      }),
    );
    if (current.kind === 'recovery_plan') {
      expect(current.generation.snapshotDigest).not.toBe(first.generation.snapshotDigest);
    }
  });

  it('rejects malformed generation tokens without reading the journal', async () => {
    const database = getExecutionJournalDb();
    const readSpy = jest.spyOn(database, 'getFirstSync');

    const result = await queryExecutionRecovery({
      runId: 'run-1',
      expectedGeneration: {
        controlEpoch: 0,
        updatedAt: 0,
        snapshotDigest: 'not-a-digest',
      },
    });

    expect(result).toEqual(blockedResult('run-1', 'generation_mismatch'));
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('fails closed before opening the journal for an invalid run identifier', async () => {
    expect(await queryExecutionRecovery({ runId: ' run-1' })).toEqual({
      kind: 'query_blocked',
      runId: null,
      generation: null,
      reason: 'invalid_request',
    });
  });

  it('returns a closed journal failure instead of leaking storage errors', async () => {
    getExecutionJournalDb().closeSync();

    expect(await queryExecutionRecovery({ runId: 'run-1' })).toEqual(
      blockedResult('run-1', 'journal_unavailable'),
    );
  });

  it('keeps query failure reasons closed and exhaustive', () => {
    expect(EXECUTION_RECOVERY_QUERY_BLOCK_REASONS).toEqual([
      'invalid_request',
      'run_unavailable',
      'journal_unavailable',
      'malformed_row',
      'mixed_ownership',
      'missing_history',
      'generation_mismatch',
    ]);
  });
});

describe('execution recovery query corruption boundaries', () => {
  it.each([
    ['run', "UPDATE execution_runs SET input_digest = 'invalid' WHERE id = 'run-1'"],
    [
      'checkpoint',
      "UPDATE execution_checkpoints SET state_digest = 'invalid' WHERE id = 'checkpoint-1'",
    ],
    ['effect', "UPDATE execution_effects SET request_digest = 'invalid' WHERE id = 'effect-a'"],
    [
      'external handle',
      "UPDATE execution_external_handles SET scope_digest = 'invalid' WHERE id = 'handle-a'",
    ],
  ])('fails closed on a malformed %s row', async (_label, corruptionSql) => {
    const database = getExecutionJournalDb();
    seedOrderedRecoveryGraph(database);
    database.execSync('PRAGMA ignore_check_constraints = ON');
    database.execSync(corruptionSql);
    database.execSync('PRAGMA ignore_check_constraints = OFF');
    const execSpy = jest.spyOn(database, 'execSync');

    expect(await queryExecutionRecovery({ runId: 'run-1' })).toEqual(
      blockedResult('run-1', 'malformed_row'),
    );
    expect(execSpy.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('fails closed when a run has no canonical initial history', async () => {
    const database = getExecutionJournalDb();
    insertRun(database, recoveryRun({ status: 'running' }));

    expect(await queryExecutionRecovery({ runId: 'run-1' })).toEqual(
      blockedResult('run-1', 'missing_history'),
    );
  });

  it('fails closed when an effect has no persisted checkpoint lineage', async () => {
    const database = getExecutionJournalDb();
    seedOwnedRecoveryRun(database, 'run-1');
    insertRecoveryEffect(
      database,
      recoveryEffect('planned', { checkpointId: null, createdAt: 30, updatedAt: 30 }),
    );

    expect(await queryExecutionRecovery({ runId: 'run-1' })).toEqual(
      blockedResult('run-1', 'missing_history'),
    );
  });

  it('rejects an effect linked to another run checkpoint', async () => {
    const database = getExecutionJournalDb();
    seedOwnedRecoveryRun(database, 'run-1');
    const other = seedOwnedRecoveryRun(database, 'run-2');
    database.execSync('PRAGMA foreign_keys = OFF');
    insertRecoveryEffect(
      database,
      recoveryEffect('planned', {
        id: 'cross-owned-effect',
        runId: 'run-1',
        checkpointId: other.workCheckpointId,
      }),
    );
    database.execSync('PRAGMA foreign_keys = ON');

    expect(await queryExecutionRecovery({ runId: 'run-1' })).toEqual(
      blockedResult('run-1', 'mixed_ownership'),
    );
  });

  it('rejects an external handle linked to another run effect', async () => {
    const database = getExecutionJournalDb();
    seedOwnedRecoveryRun(database, 'run-1');
    const other = seedOwnedRecoveryRun(database, 'run-2');
    insertRecoveryEffect(
      database,
      recoveryEffect('started', {
        id: 'run-2-effect',
        runId: 'run-2',
        checkpointId: other.workCheckpointId,
      }),
    );
    database.execSync('PRAGMA foreign_keys = OFF');
    insertRecoveryHandle(
      database,
      recoveryHandle('pending', {
        id: 'cross-owned-handle',
        runId: 'run-1',
        effectId: 'run-2-effect',
      }),
    );
    database.execSync('PRAGMA foreign_keys = ON');

    expect(await queryExecutionRecovery({ runId: 'run-1' })).toEqual(
      blockedResult('run-1', 'mixed_ownership'),
    );
  });
});

describe('execution recovery query retention and ordering', () => {
  it('treats never-present and retention-deleted runs as the same unavailable state', async () => {
    const neverPresent = await queryExecutionRecovery({ runId: 'run-1' });
    seedExecutionRun();
    transitionExecutionRun({
      runId: 'run-1',
      expectedStatus: 'queued',
      nextStatus: 'failed',
      expectedControlEpoch: 0,
      nextControlEpoch: 0,
      occurredAt: 11,
    });
    expect(deleteRetainedTerminalExecutionRun('run-1')).toBe('deleted');

    const retained = await queryExecutionRecovery({ runId: 'run-1' });

    expect(neverPresent).toEqual(blockedResult('run-1', 'run_unavailable'));
    expect(retained).toEqual(neverPresent);
    expect(JSON.stringify(retained)).not.toMatch(/retained|deleted|tombstone/u);
  });

  it('produces identical generations and plans regardless of insertion order', async () => {
    seedOrderedRecoveryGraph(getExecutionJournalDb());
    const forward = await queryExecutionRecovery({ runId: 'run-1' });

    resetJournal();
    seedOrderedRecoveryGraph(getExecutionJournalDb(), true);
    const reversed = await queryExecutionRecovery({ runId: 'run-1' });

    expect(reversed).toEqual(forward);
    expect(reversed).toEqual(
      expect.objectContaining({
        kind: 'recovery_plan',
        command: {
          kind: 'reconcile_external_handles',
          runId: 'run-1',
          controlEpoch: 0,
          effectIds: ['effect-a', 'effect-b'],
          handleIds: ['handle-a', 'handle-b'],
        },
      }),
    );
  });
});
