jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});

const mockInvalidateVerifiedProcedureObservationsForExecutionRun = jest.fn();
jest.mock('../../src/services/memory/verifiedProcedure/invalidation', () => ({
  invalidateVerifiedProcedureObservationsForExecutionRun: (...args: unknown[]) =>
    mockInvalidateVerifiedProcedureObservationsForExecutionRun(...args),
}));

import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';
import { buildModelTurnMemoryPolicyBinding } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import {
  dispatchAuthorizedToolEffect,
  type AuthorizedToolEffectDispatchInput,
} from '../../src/services/executionJournal/toolEffectDispatchLifecycle';
import { EXECUTION_JOURNAL_BUSY_TIMEOUT_MS } from '../../src/services/executionJournal/schema';
import { closeMemoryDb, getMemoryDb } from '../../src/services/memory/database';
import { initializeMemoryPolicyObservation } from '../../src/services/memory/policy';
import { resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { completedToolOutcome, type ToolRuntimeOutcome } from '../../src/types/toolRuntimeOutcome';
import { captureCurrentModelTurnMemoryFence } from '../helpers/modelTurnMemoryAuthority';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};

function verifiedWriteResult(): ToolRuntimeOutcome {
  return completedToolOutcome(
    JSON.stringify({
      status: 'written',
      path: 'reports/private.md',
      size: 4,
      sha256: 'a'.repeat(64),
    }),
  );
}

function memoryBoundInput(
  execute: AuthorizedToolEffectDispatchInput['execute'],
  overrides: Partial<AuthorizedToolEffectDispatchInput> = {},
): AuthorizedToolEffectDispatchInput {
  const fence = captureCurrentModelTurnMemoryFence();
  return {
    conversationId: 'conversation-memory-authority-claim',
    toolCallId: 'tool-call-memory-authority-claim',
    toolName: 'write_file',
    argumentsText: JSON.stringify({ path: 'reports/private.md', content: 'done' }),
    context: { executionRunId: 'execution-run-memory-authority-claim' },
    approvalState: 'not_required',
    modelTurnMemoryPolicyBinding: buildModelTurnMemoryPolicyBinding(fence),
    authority: {
      approvalGranted: () => true,
      permissionGranted: () => true,
      controlGranted: () => true,
    },
    execute,
    ...overrides,
  };
}

function attachedDatabaseNames(database: SQLiteDatabase): string[] {
  return database.getAllSync<{ name: string }>('PRAGMA database_list').map((row) => row.name);
}

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  closeMemoryDb();
  sqliteMock.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  useSettingsStore.setState({ disableLongTermMemory: false });
  initializeMemoryPolicyObservation();
  mockInvalidateVerifiedProcedureObservationsForExecutionRun.mockReturnValue({
    status: 'invalidated',
    deletedCount: 0,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  useSettingsStore.setState({ disableLongTermMemory: false });
  try {
    closeExecutionJournalDb();
  } catch {}
  closeMemoryDb();
});

describe('memory-bound atomic tool-effect claim', () => {
  it('rejects a file-backed cross-runtime claim at exact memory-expiry equality', async () => {
    const execute = jest.fn(async () => verifiedWriteResult());
    const fence = captureCurrentModelTurnMemoryFence();
    const clock = jest
      .fn<() => number>()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(199)
      .mockReturnValue(200);
    const input = memoryBoundInput(execute, {
      modelTurnMemoryPolicyBinding: buildModelTurnMemoryPolicyBinding({
        ...fence,
        validUntil: 200,
      }),
    });

    const result = await dispatchAuthorizedToolEffect(input, { now: clock });

    expect(result).toMatchObject({ kind: 'blocked', reason: 'model_authority_expired' });
    expect(execute).not.toHaveBeenCalled();
    expect(clock).toHaveBeenCalledTimes(3);
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT e.model_authority_valid_until, e.status AS effect_status,
                r.status AS run_status
           FROM execution_effects AS e
           JOIN execution_runs AS r ON r.id = e.run_id`,
      ),
    ).toEqual({
      model_authority_valid_until: 200,
      effect_status: 'cancelled',
      run_status: 'cancelled',
    });
  });

  it('detaches memory authority before executing and settles the exact durable claim', async () => {
    const execute = jest.fn(async () => {
      const journal = getExecutionJournalDb();
      expect(attachedDatabaseNames(journal)).toEqual(['main']);
      expect(
        journal.getFirstSync<{ status: string }>('SELECT status FROM execution_effects LIMIT 1'),
      ).toEqual({ status: 'started' });
      return verifiedWriteResult();
    });

    const result = await dispatchAuthorizedToolEffect(memoryBoundInput(execute), {
      now: () => 100,
    });

    expect(result).toMatchObject({ kind: 'executed', requiresReconciliation: false });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(attachedDatabaseNames(getExecutionJournalDb())).toEqual(['main']);
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'succeeded', effect_status: 'verified' });
  });

  it('bounds synchronous native lock waiting for the mobile execution journal', () => {
    const journal = getExecutionJournalDb();

    expect(journal.getFirstSync<{ timeout: number }>('PRAGMA busy_timeout')).toEqual({
      timeout: EXECUTION_JOURNAL_BUSY_TIMEOUT_MS,
    });
    expect(EXECUTION_JOURNAL_BUSY_TIMEOUT_MS).toBeLessThanOrEqual(100);
  });

  it('detaches before journal-only cancellation when another memory writer holds the lock', async () => {
    const journal = getExecutionJournalDb();
    journal.execSync('PRAGMA busy_timeout = 1');
    const beginAttachmentStates: boolean[] = [];
    const wrappedJournal = new Proxy(journal, {
      get(target, property, receiver) {
        if (property === 'execSync') {
          return (sql: string): void => {
            if (sql.trim().toUpperCase() === 'BEGIN IMMEDIATE') {
              beginAttachmentStates.push(
                attachedDatabaseNames(target).includes('memory_effect_authority'),
              );
            }
            target.execSync(sql);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as SQLiteDatabase;
    const execute = jest.fn(async () => verifiedWriteResult());
    const input = memoryBoundInput(execute);
    const externalMemoryWriter = new Database(getMemoryDb().databasePath);
    externalMemoryWriter.exec(
      `BEGIN IMMEDIATE;
       UPDATE memory_vault_identity SET created_at = created_at WHERE singleton = 1`,
    );

    try {
      const result = await dispatchAuthorizedToolEffect(input, {
        getDatabase: () => wrappedJournal,
        now: () => 100,
      });

      expect(result).toMatchObject({ kind: 'blocked', reason: 'journal_unavailable' });
      expect(execute).not.toHaveBeenCalled();
      expect(beginAttachmentStates).toEqual([false, true, false]);
      expect(attachedDatabaseNames(journal)).toEqual(['main']);
      expect(
        journal.getFirstSync(
          `SELECT r.status AS run_status, e.status AS effect_status
             FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
        ),
      ).toEqual({ run_status: 'cancelled', effect_status: 'cancelled' });
    } finally {
      externalMemoryWriter.exec('ROLLBACK');
      externalMemoryWriter.close();
    }
  });

  it('quarantines an uncertain attachment before returning a typed unavailable rejection', async () => {
    const journal = getExecutionJournalDb();
    const originalRunSync = journal.runSync.bind(journal);
    let attachFailed = false;
    jest.spyOn(journal, 'runSync').mockImplementation((sql, ...params) => {
      const result = originalRunSync(sql, ...params);
      if (!attachFailed && sql.trim().startsWith('ATTACH DATABASE')) {
        attachFailed = true;
        throw new Error('injected_attach_completion_failure');
      }
      return result;
    });
    const close = jest.spyOn(journal, 'closeSync');
    const execute = jest.fn(async () => verifiedWriteResult());

    const result = await dispatchAuthorizedToolEffect(memoryBoundInput(execute), {
      now: () => 100,
    });

    expect(result).toMatchObject({ kind: 'blocked', reason: 'model_authority_unavailable' });
    expect(execute).not.toHaveBeenCalled();
    expect(attachFailed).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(attachedDatabaseNames(getExecutionJournalDb())).toEqual(['main']);
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'cancelled', effect_status: 'cancelled' });
  });

  it('quarantines a connection when detach fails and never invokes the executor', async () => {
    const journal = getExecutionJournalDb();
    const originalExecSync = journal.execSync.bind(journal);
    let detachFailed = false;
    jest.spyOn(journal, 'execSync').mockImplementation((sql: string) => {
      if (!detachFailed && sql.trim() === 'DETACH DATABASE memory_effect_authority') {
        detachFailed = true;
        throw new Error('injected_detach_failure');
      }
      originalExecSync(sql);
    });
    const close = jest.spyOn(journal, 'closeSync');
    const execute = jest.fn(async () => verifiedWriteResult());

    const result = await dispatchAuthorizedToolEffect(memoryBoundInput(execute), {
      now: () => 100,
    });

    expect(result).toMatchObject({
      kind: 'reconciliation_required',
      reason: 'claim_outcome_unknown',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(detachFailed).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    const reopenedJournal = getExecutionJournalDb();
    expect(attachedDatabaseNames(reopenedJournal)).toEqual(['main']);
    expect(
      reopenedJournal.getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'running', effect_status: 'started' });
  });

  it('quarantines an unknown commit outcome even after a clean detach', async () => {
    const journal = getExecutionJournalDb();
    const originalExecSync = journal.execSync.bind(journal);
    let commitReportedFailure = false;
    let rollbackReportedFailure = false;
    jest.spyOn(journal, 'execSync').mockImplementation((sql: string) => {
      const attached = attachedDatabaseNames(journal).includes('memory_effect_authority');
      if (!commitReportedFailure && attached && sql.trim() === 'COMMIT') {
        originalExecSync(sql);
        commitReportedFailure = true;
        throw new Error('injected_commit_result_unknown');
      }
      if (commitReportedFailure && attached && sql.trim() === 'ROLLBACK') {
        rollbackReportedFailure = true;
        throw new Error('injected_rollback_result_unknown');
      }
      originalExecSync(sql);
    });
    const close = jest.spyOn(journal, 'closeSync');
    const execute = jest.fn(async () => verifiedWriteResult());

    const result = await dispatchAuthorizedToolEffect(memoryBoundInput(execute), {
      now: () => 100,
    });

    expect(result).toMatchObject({
      kind: 'reconciliation_required',
      reason: 'claim_outcome_unknown',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(commitReportedFailure).toBe(true);
    expect(rollbackReportedFailure).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    const reopenedJournal = getExecutionJournalDb();
    expect(attachedDatabaseNames(reopenedJournal)).toEqual(['main']);
    expect(
      reopenedJournal.getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'running', effect_status: 'started' });
  });
});
