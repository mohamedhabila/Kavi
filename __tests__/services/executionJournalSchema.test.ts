jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import type * as SQLite from 'expo-sqlite';
import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import {
  decodeExecutionCheckpointRow,
  decodeExecutionEffectRow,
  decodeExecutionExternalHandleRow,
  decodeExecutionMonitorRow,
  decodeExecutionRunRow,
} from '../../src/services/executionJournal/decoders';
import {
  deleteRetainedTerminalExecutionRun,
  pruneRetainedTerminalExecutionRuns,
} from '../../src/services/executionJournal/retention';
import {
  EXECUTION_JOURNAL_APPLICATION_ID,
  EXECUTION_JOURNAL_SCHEMA_VERSION,
} from '../../src/services/executionJournal/schema';
import {
  EXECUTION_RUN_STATUSES,
  RETENTION_DELETABLE_RUN_STATUSES,
} from '../../src/services/executionJournal/types';
import {
  DIGEST_A,
  DIGEST_D,
  insertSchemaCheckpoint as insertCheckpoint,
  insertSchemaEffect as insertEffect,
  insertSchemaHandle as insertHandle,
  insertSchemaMonitor as insertMonitor,
  insertSchemaRun as insertRun,
  seedCompleteSchemaRun as seedCompleteRun,
} from '../helpers/executionJournalSchemaFixtures';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  openDatabaseSync: (name: string) => SQLite.SQLiteDatabase;
  __resetExpoSqliteForTests: () => void;
};

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {
    // A fail-closed schema test may already have closed the handle.
  }
  sqliteMock.__resetExpoSqliteForTests();
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {
    // Ignore teardown of an intentionally rejected handle.
  }
});

describe('execution journal schema bootstrap', () => {
  it('creates one separate strict, versioned control-plane database', () => {
    const db = getExecutionJournalDb();
    expect(db.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(
      EXECUTION_JOURNAL_SCHEMA_VERSION,
    );
    expect(
      db.getFirstSync<{ application_id: number }>('PRAGMA application_id')?.application_id,
    ).toBe(EXECUTION_JOURNAL_APPLICATION_ID);
    expect(
      db
        .getAllSync<{ name: string }>(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        )
        .map((row) => row.name),
    ).toEqual([
      'execution_checkpoints',
      'execution_effect_receipts',
      'execution_effects',
      'execution_external_handles',
      'execution_monitors',
      'execution_recovery_attention',
      'execution_recovery_controls',
      'execution_recovery_dispatches',
      'execution_runs',
    ]);
    const strictTables = db
      .getAllSync<{ name: string; strict: number }>('PRAGMA table_list')
      .filter((row) => row.name.startsWith('execution_'));
    expect(strictTables).toHaveLength(9);
    expect(strictTables.every((row) => row.strict === 1)).toBe(true);
  });

  it('reopens idempotently without replacing existing rows', () => {
    const first = getExecutionJournalDb();
    insertRun(first);
    closeExecutionJournalDb();

    const reopened = getExecutionJournalDb();
    expect(
      reopened.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM execution_runs')
        ?.count,
    ).toBe(1);
    expect(getExecutionJournalDb()).toBe(reopened);
  });

  it('contains IDs, hashes, and closed metadata but no raw sensitive payload columns', () => {
    const db = getExecutionJournalDb();
    const columnNames = [
      'execution_runs',
      'execution_checkpoints',
      'execution_effect_receipts',
      'execution_effects',
      'execution_external_handles',
      'execution_recovery_attention',
      'execution_monitors',
      'execution_recovery_controls',
      'execution_recovery_dispatches',
    ].flatMap((table) =>
      db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`).map((row) => row.name),
    );
    expect(columnNames).toContain('credential_ref');
    expect(
      columnNames
        .filter((name) => name !== 'credential_ref')
        .some((name) =>
          /(prompt|credential|argument|result|api_key|secret|token|raw_)/u.test(name),
        ),
    ).toBe(false);
  });
});

describe('closed SQL constraints', () => {
  it.each([
    ['durability_class', 'unsupported'],
    ['requested_capability', 'unsupported'],
    ['execution_surface', 'unsupported'],
    ['status', 'unsupported'],
    ['resume_strategy', 'unsupported'],
    ['approval_state', 'unsupported'],
    ['permission_state', 'unsupported'],
    ['next_retry_policy', 'unsupported'],
    ['input_digest', 'not-a-digest'],
    ['retry_count', -1],
    ['control_epoch', -1],
    ['updated_at', 9],
    ['id', ''],
  ])('rejects invalid execution_runs.%s', (column, value) => {
    const db = getExecutionJournalDb();
    expect(() => insertRun(db, { [column]: value })).toThrow();
  });

  it('accepts every closed run status only with its permitted terminal timestamp shape', () => {
    const db = getExecutionJournalDb();
    for (const [index, status] of EXECUTION_RUN_STATUSES.entries()) {
      const terminal = (RETENTION_DELETABLE_RUN_STATUSES as readonly string[]).includes(status);
      expect(() =>
        insertRun(db, {
          id: `run-${index}`,
          status,
          terminal_at: terminal ? 20 : null,
          updated_at: terminal ? 20 : 10,
        }),
      ).not.toThrow();
    }
    expect(() =>
      insertRun(db, { id: 'bad-running-terminal', status: 'running', terminal_at: 20 }),
    ).toThrow();
    expect(() =>
      insertRun(db, {
        id: 'bad-terminal-missing',
        status: 'failed',
        terminal_at: null,
        updated_at: 20,
      }),
    ).toThrow();
    expect(() =>
      insertRun(db, {
        id: 'bad-terminal-future',
        status: 'failed',
        terminal_at: 20,
        updated_at: 19,
      }),
    ).toThrow();
  });

  it.each([
    ['phase', 'unsupported'],
    ['boundary', 'unsupported'],
    ['resume_strategy', 'unsupported'],
    ['approval_state', 'unsupported'],
    ['permission_state', 'unsupported'],
    ['state_digest', 'bad'],
    ['sequence', -1],
    ['control_epoch', -1],
  ])('rejects invalid execution_checkpoints.%s', (column, value) => {
    const db = getExecutionJournalDb();
    insertRun(db);
    expect(() => insertCheckpoint(db, { [column]: value })).toThrow();
  });

  it('enforces checkpoint ownership, ordering, and run foreign keys', () => {
    const db = getExecutionJournalDb();
    insertRun(db);
    insertCheckpoint(db);
    expect(() => insertCheckpoint(db, { id: 'checkpoint-2' })).toThrow();
    expect(() => insertCheckpoint(db, { id: 'checkpoint-3', run_id: 'missing-run' })).toThrow();
  });

  it.each([
    ['effect_class', 'unsupported'],
    ['idempotency_class', 'unsupported'],
    ['status', 'unsupported'],
    ['retry_policy', 'unsupported'],
    ['tool_name_digest', 'bad'],
    ['request_digest', 'bad'],
    ['idempotency_key_digest', 'bad'],
    ['attempt', 0],
    ['updated_at', 9],
  ])('rejects invalid execution_effects.%s', (column, value) => {
    const db = getExecutionJournalDb();
    insertRun(db);
    insertCheckpoint(db);
    expect(() => insertEffect(db, { [column]: value })).toThrow();
  });

  it('enforces effect lifecycle timestamps and same-run checkpoint ownership', () => {
    const db = getExecutionJournalDb();
    insertRun(db);
    insertCheckpoint(db);
    expect(() => insertEffect(db, { status: 'started', started_at: null })).toThrow();
    expect(() =>
      insertEffect(db, { status: 'verified', started_at: 11, completed_at: null }),
    ).toThrow();
    expect(() => insertEffect(db, { status: 'started', started_at: 11, updated_at: 10 })).toThrow();
    expect(() =>
      insertEffect(db, {
        status: 'verified',
        started_at: 11,
        completed_at: 12,
        updated_at: 11,
      }),
    ).toThrow();

    insertRun(db, { id: 'run-2' });
    insertCheckpoint(db, { id: 'checkpoint-2', run_id: 'run-2' });
    expect(() => insertEffect(db, { checkpoint_id: 'checkpoint-2' })).toThrow();
  });

  it.each([
    ['handle_kind', 'unsupported'],
    ['status', 'unsupported'],
    ['locator_version', 2],
    ['expo_project_id', null],
    ['credential_ref', ''],
    ['source_tool_name_digest', 'bad'],
    ['workflow_run_id', ''],
    ['updated_at', 9],
    ['last_attempted_at', 11],
  ])('rejects invalid execution_external_handles.%s', (column, value) => {
    const db = getExecutionJournalDb();
    seedCompleteRun(db);
    db.runSync('DELETE FROM execution_external_handles');
    expect(() => insertHandle(db, { [column]: value })).toThrow();
  });

  it('enforces external-handle effect ownership and exact handle uniqueness', () => {
    const db = getExecutionJournalDb();
    seedCompleteRun(db);
    expect(() => insertHandle(db, { id: 'handle-2' })).toThrow();
    insertRun(db, { id: 'run-2' });
    insertCheckpoint(db, { id: 'checkpoint-2', run_id: 'run-2' });
    insertEffect(db, {
      id: 'effect-2',
      run_id: 'run-2',
      checkpoint_id: 'checkpoint-2',
      tool_call_id: 'tool-call-2',
    });
    expect(() => insertHandle(db, { id: 'handle-3', effect_id: 'effect-2' })).toThrow();
  });

  it('stores GitHub repository locators only in canonical lowercase form', () => {
    const db = getExecutionJournalDb();
    seedCompleteRun(db);
    db.runSync('DELETE FROM execution_external_handles');
    expect(() =>
      insertHandle(db, {
        handle_kind: 'github_workflow_run',
        expo_project_id: null,
        github_repository: 'OpenAI/Kavi-Mobile',
        workflow_run_id: '12345',
      }),
    ).toThrow();
    expect(() =>
      insertHandle(db, {
        handle_kind: 'github_workflow_run',
        expo_project_id: null,
        github_repository: 'openai/kavi-mobile',
        workflow_run_id: '12345',
      }),
    ).not.toThrow();
  });

  it('rejects external-handle verification timestamps later than the row update', () => {
    const db = getExecutionJournalDb();
    seedCompleteRun(db);
    db.runSync('DELETE FROM execution_external_handles');
    expect(() => insertHandle(db, { last_verified_at: 11, updated_at: 10 })).toThrow();
  });

  it.each([
    ['baseline_status', 'unsupported'],
    ['condition_kind', 'unsupported'],
    ['action_kind', 'unsupported'],
    ['state', 'unsupported'],
    ['observation_count', 0],
    ['last_observed_at', 11],
    ['next_legal_check_at', 9],
  ])('rejects invalid execution_monitors.%s', (column, value) => {
    const db = getExecutionJournalDb();
    seedCompleteRun(db);
    db.runSync('DELETE FROM execution_monitors');
    expect(() => insertMonitor(db, { [column]: value })).toThrow();
  });

  it('enforces monitor ownership and closed state timelines', () => {
    const db = getExecutionJournalDb();
    seedCompleteRun(db);
    expect(() => insertMonitor(db, { id: 'monitor-duplicate' })).toThrow();
    db.runSync('DELETE FROM execution_monitors');
    expect(() =>
      insertMonitor(db, {
        state: 'acted',
        next_legal_check_at: null,
        last_observed_status: 'succeeded',
        condition_met_at: 10,
        acted_at: 10,
      }),
    ).not.toThrow();
    db.runSync('DELETE FROM execution_monitors');
    expect(() =>
      insertMonitor(db, {
        state: 'acted',
        next_legal_check_at: null,
        last_observed_status: 'running',
        condition_met_at: 10,
        acted_at: 10,
      }),
    ).toThrow();
    expect(() =>
      insertMonitor(db, {
        run_id: 'missing-run',
        external_handle_id: 'handle-1',
      }),
    ).toThrow();
  });
});

describe('idempotency and relational integrity', () => {
  it('enforces the partial unique idempotency-key index without conflating null keys', () => {
    const db = getExecutionJournalDb();
    insertRun(db);
    insertCheckpoint(db);
    insertEffect(db, { idempotency_key_digest: DIGEST_D });
    expect(() =>
      insertEffect(db, {
        id: 'effect-2',
        tool_call_id: 'tool-call-2',
        attempt: 2,
        idempotency_key_digest: DIGEST_D,
      }),
    ).toThrow();
    expect(() =>
      insertEffect(db, { id: 'effect-3', tool_call_id: 'tool-call-3', attempt: 2 }),
    ).not.toThrow();
    expect(() =>
      insertEffect(db, { id: 'effect-4', tool_call_id: 'tool-call-4', attempt: 3 }),
    ).not.toThrow();

    insertRun(db, { id: 'run-2' });
    insertCheckpoint(db, { id: 'checkpoint-2', run_id: 'run-2' });
    expect(() =>
      insertEffect(db, {
        id: 'effect-5',
        run_id: 'run-2',
        checkpoint_id: 'checkpoint-2',
        tool_call_id: 'tool-call-5',
        idempotency_key_digest: DIGEST_D,
      }),
    ).not.toThrow();
  });

  it('cascades run deletion through checkpoints, effects, and external handles', () => {
    const db = getExecutionJournalDb();
    seedCompleteRun(db);
    db.runSync(
      `UPDATE execution_runs
       SET status = 'succeeded', updated_at = 20, terminal_at = 20
       WHERE id = ?`,
      'run-1',
    );

    db.runSync('DELETE FROM execution_runs WHERE id = ?', 'run-1');

    for (const table of [
      'execution_runs',
      'execution_checkpoints',
      'execution_effects',
      'execution_external_handles',
      'execution_recovery_attention',
      'execution_monitors',
      'execution_recovery_controls',
      'execution_recovery_dispatches',
    ]) {
      expect(
        db.getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)?.count,
      ).toBe(0);
    }
  });

  it.each(['queued', 'running', 'waiting', 'blocked', 'interrupted', 'ambiguous'])(
    'blocks direct deletion of protected %s runs',
    (status) => {
      const db = getExecutionJournalDb();
      insertRun(db, { status });
      expect(() => db.runSync('DELETE FROM execution_runs WHERE id = ?', 'run-1')).toThrow(
        'execution_journal_protected_run',
      );
      expect(
        db.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM execution_runs')?.count,
      ).toBe(1);
    },
  );
});

describe('strict row decoders', () => {
  it('decodes exact rows from every normalized execution record', () => {
    const db = getExecutionJournalDb();
    seedCompleteRun(db);
    expect(decodeExecutionRunRow(db.getFirstSync('SELECT * FROM execution_runs'))).toEqual(
      expect.objectContaining({ id: 'run-1', status: 'running', inputDigest: DIGEST_A }),
    );
    expect(
      decodeExecutionCheckpointRow(db.getFirstSync('SELECT * FROM execution_checkpoints')),
    ).toEqual(expect.objectContaining({ id: 'checkpoint-1', boundary: 'run_created' }));
    expect(decodeExecutionEffectRow(db.getFirstSync('SELECT * FROM execution_effects'))).toEqual(
      expect.objectContaining({ id: 'effect-1', status: 'planned' }),
    );
    expect(
      decodeExecutionExternalHandleRow(db.getFirstSync('SELECT * FROM execution_external_handles')),
    ).toEqual(
      expect.objectContaining({
        id: 'handle-1',
        locator: {
          version: 1,
          kind: 'expo_workflow_run',
          projectId: 'project-1',
          workflowRunId: 'workflow-run-1',
          credentialRef: 'EXPO_TOKEN',
        },
      }),
    );
    expect(decodeExecutionMonitorRow(db.getFirstSync('SELECT * FROM execution_monitors'))).toEqual(
      expect.objectContaining({
        id: 'monitor-1',
        baselineStatus: 'pending',
        condition: 'external_handle_terminal',
        action: 'reconcile_external_handle',
        state: 'armed',
        nextLegalCheckAt: 10,
      }),
    );
  });

  it.each([
    ['run', decodeExecutionRunRow, () => insertRun(getExecutionJournalDb())],
    [
      'checkpoint',
      decodeExecutionCheckpointRow,
      () => {
        const db = getExecutionJournalDb();
        insertRun(db);
        insertCheckpoint(db);
      },
    ],
    [
      'effect',
      decodeExecutionEffectRow,
      () => {
        const db = getExecutionJournalDb();
        insertRun(db);
        insertCheckpoint(db);
        insertEffect(db);
      },
    ],
    [
      'external_handle',
      decodeExecutionExternalHandleRow,
      () => seedCompleteRun(getExecutionJournalDb()),
    ],
    ['monitor', decodeExecutionMonitorRow, () => seedCompleteRun(getExecutionJournalDb())],
  ])('rejects extra raw payload fields in %s rows', (table, decoder, seed) => {
    seed();
    const db = getExecutionJournalDb();
    const tableName =
      table === 'external_handle'
        ? 'execution_external_handles'
        : table === 'monitor'
          ? 'execution_monitors'
          : `execution_${table}s`;
    const row = db.getFirstSync<Record<string, unknown>>(`SELECT * FROM ${tableName}`)!;
    expect(() => decoder({ ...row, raw_prompt: 'must never be stored' })).toThrow(
      `execution_journal_malformed_row:${table}:columns`,
    );
  });

  it('rejects malformed values and timelines across every row decoder', () => {
    const db = getExecutionJournalDb();
    seedCompleteRun(db);
    const run = db.getFirstSync<Record<string, unknown>>('SELECT * FROM execution_runs')!;
    const checkpoint = db.getFirstSync<Record<string, unknown>>(
      'SELECT * FROM execution_checkpoints',
    )!;
    const effect = db.getFirstSync<Record<string, unknown>>('SELECT * FROM execution_effects')!;
    const handle = db.getFirstSync<Record<string, unknown>>(
      'SELECT * FROM execution_external_handles',
    )!;
    const monitor = db.getFirstSync<Record<string, unknown>>('SELECT * FROM execution_monitors')!;
    expect(() => decodeExecutionRunRow({ ...run, status: 'mystery' })).toThrow();
    expect(() => decodeExecutionRunRow({ ...run, input_digest: 'bad' })).toThrow();
    expect(() => decodeExecutionRunRow({ ...run, retry_count: 1.5 })).toThrow();
    expect(() => decodeExecutionRunRow({ ...run, updated_at: 1 })).toThrow();
    expect(() => decodeExecutionCheckpointRow({ ...checkpoint, sequence: -1 })).toThrow();
    const {
      model_authority_valid_until: _discardedModelAuthorityDeadline,
      ...legacyEffectWithoutDeadline
    } = effect;
    expect(() => decodeExecutionEffectRow(legacyEffectWithoutDeadline)).toThrow(
      'execution_journal_malformed_row:effect:columns',
    );
    expect(() =>
      decodeExecutionEffectRow({ ...effect, model_authority_valid_until: 10.5 }),
    ).toThrow('execution_journal_malformed_row:effect.model_authority_valid_until');
    expect(() =>
      decodeExecutionEffectRow({
        ...effect,
        status: 'started',
        started_at: 11,
        updated_at: 10,
      }),
    ).toThrow('execution_journal_malformed_row:effect:timeline');
    expect(() =>
      decodeExecutionExternalHandleRow({
        ...handle,
        last_attempted_at: 11,
        updated_at: 10,
      }),
    ).toThrow('execution_journal_malformed_row:external_handle:timeline');
    expect(() =>
      decodeExecutionExternalHandleRow({
        ...handle,
        last_verified_at: 11,
        updated_at: 10,
      }),
    ).toThrow('execution_journal_malformed_row:external_handle:timeline');
    expect(() =>
      decodeExecutionMonitorRow({
        ...monitor,
        state: 'acted',
        next_legal_check_at: null,
        last_observed_status: 'running',
        condition_met_at: 10,
        acted_at: 10,
      }),
    ).toThrow('execution_journal_malformed_row:monitor:timeline');
  });
});

describe('retention and explicit deletion', () => {
  it('prunes only old unambiguous terminal runs and preserves every other status', () => {
    const db = getExecutionJournalDb();
    for (const [index, status] of EXECUTION_RUN_STATUSES.entries()) {
      const deletable = (RETENTION_DELETABLE_RUN_STATUSES as readonly string[]).includes(status);
      insertRun(db, {
        id: `retention-${status}`,
        status,
        terminal_at: deletable ? 20 + index : null,
        updated_at: 20 + index,
      });
    }
    insertRun(db, {
      id: 'recent-terminal',
      status: 'succeeded',
      terminal_at: 10_000,
      updated_at: 10_000,
    });

    expect(pruneRetainedTerminalExecutionRuns({ terminalBefore: 1_000, limit: 100 })).toBe(3);

    const remaining = db
      .getAllSync<{ id: string }>('SELECT id FROM execution_runs ORDER BY id')
      .map((row) => row.id);
    expect(remaining).toContain('retention-ambiguous');
    expect(remaining).toContain('retention-interrupted');
    expect(remaining).toContain('retention-running');
    expect(remaining).toContain('retention-waiting');
    expect(remaining).toContain('recent-terminal');
    expect(remaining).not.toContain('retention-succeeded');
    expect(remaining).not.toContain('retention-failed');
    expect(remaining).not.toContain('retention-cancelled');
  });

  it('protects nonterminal and ambiguous runs from explicit deletion', () => {
    const db = getExecutionJournalDb();
    insertRun(db, { id: 'ambiguous-run', status: 'ambiguous' });
    insertRun(db, { id: 'running-run', status: 'running' });
    insertRun(db, {
      id: 'terminal-run',
      status: 'failed',
      terminal_at: 20,
      updated_at: 20,
    });

    expect(deleteRetainedTerminalExecutionRun('ambiguous-run')).toBe('protected');
    expect(deleteRetainedTerminalExecutionRun('running-run')).toBe('protected');
    expect(deleteRetainedTerminalExecutionRun('terminal-run')).toBe('deleted');
    expect(deleteRetainedTerminalExecutionRun('missing-run')).toBe('missing');
  });

  it('rolls back retention when a selected row fails strict decoding', () => {
    const db = getExecutionJournalDb();
    db.execSync('PRAGMA ignore_check_constraints = ON');
    insertRun(db, {
      id: 'malformed-terminal',
      status: 'failed',
      terminal_at: 20,
      updated_at: 20,
      input_digest: 'invalid',
    });
    db.execSync('PRAGMA ignore_check_constraints = OFF');

    expect(() => pruneRetainedTerminalExecutionRuns({ terminalBefore: 1_000, limit: 100 })).toThrow(
      'execution_journal_malformed_row:run.input_digest',
    );
    expect(
      db.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM execution_runs')?.count,
    ).toBe(1);
  });
});
