jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import type * as SQLite from 'expo-sqlite';
import {
  closeExecutionJournalDb,
  EXECUTION_JOURNAL_DATABASE_NAME,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { transitionExecutionRun } from '../../src/services/executionJournal/mutations';
import {
  EXECUTION_JOURNAL_APPLICATION_ID,
  EXECUTION_JOURNAL_SCHEMA_VERSION,
} from '../../src/services/executionJournal/schema';
import {
  DIGEST_C,
  DIGEST_D,
  insertSchemaCheckpoint,
  insertSchemaEffect,
  insertSchemaHandle,
  insertSchemaMonitor,
  insertSchemaRun,
} from '../helpers/executionJournalSchemaFixtures';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  openDatabaseSync: (name: string) => SQLite.SQLiteDatabase;
  __resetExpoSqliteForTests: () => void;
};

const V8_CONTRACT_IDENTITY_COLUMN_SQL = `    tool_contract_identity_digest TEXT CHECK (
      tool_contract_identity_digest IS NULL OR (length(tool_contract_identity_digest) = 64 AND tool_contract_identity_digest NOT GLOB '*[^0-9a-f]*')
    ),
`;

const V9_MODEL_AUTHORITY_VALID_UNTIL_COLUMN_SQL = `    model_authority_valid_until INTEGER CHECK (
      model_authority_valid_until IS NULL OR model_authority_valid_until >= 0
    ),
`;

const EFFECT_INDEX_NAMES = [
  'idx_execution_effects_run_status',
  'idx_execution_effects_status_run',
  'ux_execution_effects_idempotency_key',
] as const;

interface DurableDatabaseSnapshot {
  applicationId: number | undefined;
  userVersion: number | undefined;
  objects: Array<{ name: string; sql: string | null; type: string }>;
  runs: unknown[];
  checkpoints: unknown[];
  effects: unknown[];
  handles: unknown[];
  monitors: unknown[];
}

function readDurableDatabaseSnapshot(database: SQLite.SQLiteDatabase): DurableDatabaseSnapshot {
  return {
    applicationId: database.getFirstSync<{ application_id: number }>('PRAGMA application_id')
      ?.application_id,
    userVersion: database.getFirstSync<{ user_version: number }>('PRAGMA user_version')
      ?.user_version,
    objects: database.getAllSync<{ name: string; sql: string | null; type: string }>(
      `SELECT name, sql, type FROM sqlite_master
       WHERE type IN ('table', 'index', 'trigger', 'view')
         AND name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    ),
    runs: database.getAllSync('SELECT * FROM execution_runs ORDER BY id'),
    checkpoints: database.getAllSync(
      'SELECT * FROM execution_checkpoints ORDER BY run_id, sequence',
    ),
    effects: database.getAllSync(
      'SELECT * FROM execution_effects ORDER BY run_id, tool_call_id, attempt',
    ),
    handles: database.getAllSync('SELECT * FROM execution_external_handles ORDER BY id'),
    monitors: database.getAllSync('SELECT * FROM execution_monitors ORDER BY id'),
  };
}

function seedPopulatedV8Database(database: SQLite.SQLiteDatabase): void {
  insertSchemaRun(database, {
    status: 'ambiguous',
    requested_capability: 'monitor',
    execution_surface: 'external_api',
    resume_strategy: 'reconcile_first',
    updated_at: 14,
  });
  insertSchemaCheckpoint(database);
  insertSchemaCheckpoint(database, {
    id: 'checkpoint-effect',
    sequence: 1,
    phase: 'work',
    boundary: 'before_effect',
    state_ref_id: 'state-effect',
    state_digest: DIGEST_C,
    resume_strategy: 'reconcile_first',
    approval_state: 'granted',
    permission_state: 'granted',
    created_at: 11,
  });
  insertSchemaEffect(database, {
    checkpoint_id: 'checkpoint-effect',
    tool_contract_identity_digest: null,
    effect_class: 'external_run',
    idempotency_class: 'declared_idempotent',
    idempotency_key_digest: DIGEST_D,
    status: 'ambiguous',
    retry_policy: 'reconcile_before_retry',
    created_at: 12,
    started_at: 12,
    completed_at: null,
    updated_at: 14,
  });
  insertSchemaHandle(database, {
    status: 'pending',
    created_at: 13,
    updated_at: 14,
    last_attempted_at: 14,
  });
  insertSchemaMonitor(database, {
    next_legal_check_at: 14,
    last_observed_at: 13,
    created_at: 13,
    updated_at: 14,
  });
}

function downgradePopulatedFixtureToV7(database: SQLite.SQLiteDatabase): void {
  const currentTableSql = database.getFirstSync<{ sql: string }>(
    `SELECT sql FROM sqlite_master
     WHERE type = 'table' AND name = 'execution_effects'`,
  )?.sql;
  if (
    !currentTableSql?.includes(V8_CONTRACT_IDENTITY_COLUMN_SQL) ||
    !currentTableSql.includes(V9_MODEL_AUTHORITY_VALID_UNTIL_COLUMN_SQL)
  ) {
    throw new Error('test_fixture_missing_current_effect_authority_columns');
  }
  const v7TableSql = currentTableSql
    .replace('CREATE TABLE execution_effects', 'CREATE TABLE execution_effects_v7')
    .replace(V9_MODEL_AUTHORITY_VALID_UNTIL_COLUMN_SQL, '')
    .replace(V8_CONTRACT_IDENTITY_COLUMN_SQL, '');
  const effectIndexes = database.getAllSync<{ name: string; sql: string }>(
    `SELECT name, sql FROM sqlite_master
     WHERE type = 'index' AND tbl_name = 'execution_effects'
       AND name NOT LIKE 'sqlite_autoindex_%'
     ORDER BY name`,
  );
  if (
    effectIndexes
      .map((row) => row.name)
      .sort()
      .join(',') !== [...EFFECT_INDEX_NAMES].sort().join(',')
  ) {
    throw new Error('test_fixture_unexpected_v8_effect_indexes');
  }

  database.execSync('PRAGMA foreign_keys = OFF');
  database.execSync('PRAGMA legacy_alter_table = ON');
  try {
    database.execSync('BEGIN IMMEDIATE');
    database.execSync('DROP TRIGGER trg_execution_effect_receipts_immutable');
    database.execSync('DROP TABLE execution_effect_receipts');
    database.execSync(v7TableSql);
    database.execSync(
      `INSERT INTO execution_effects_v7 (
         id, run_id, checkpoint_id, tool_call_id, tool_name_digest,
         effect_class, idempotency_class, idempotency_key_digest,
         request_digest, outcome_digest, status, retry_policy, attempt,
         created_at, started_at, completed_at, updated_at
       )
       SELECT id, run_id, checkpoint_id, tool_call_id, tool_name_digest,
              effect_class, idempotency_class, idempotency_key_digest,
              request_digest, outcome_digest, status, retry_policy, attempt,
              created_at, started_at, completed_at, updated_at
         FROM execution_effects`,
    );
    database.execSync('DROP TABLE execution_effects');
    database.execSync('ALTER TABLE execution_effects_v7 RENAME TO execution_effects');
    for (const index of effectIndexes) database.execSync(index.sql);
    database.execSync('PRAGMA user_version = 7');
    database.execSync('COMMIT');
  } catch (error) {
    try {
      database.execSync('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    database.execSync('PRAGMA legacy_alter_table = OFF');
    database.execSync('PRAGMA foreign_keys = ON');
  }
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

describe('execution journal schema migration policy', () => {
  const rawDatabase = (): SQLite.SQLiteDatabase =>
    sqliteMock.openDatabaseSync(EXECUTION_JOURNAL_DATABASE_NAME);

  it('rejects future schema versions without attempting migration', () => {
    const futureVersion = EXECUTION_JOURNAL_SCHEMA_VERSION + 1;
    rawDatabase().execSync(`PRAGMA user_version = ${futureVersion}`);
    expect(() => getExecutionJournalDb()).toThrow(
      `execution_journal_unsupported_schema_version:${futureVersion}`,
    );
  });

  it('rejects unversioned or legacy tables without importing them', () => {
    rawDatabase().execSync('CREATE TABLE legacy_runs (id TEXT PRIMARY KEY)');
    expect(() => getExecutionJournalDb()).toThrow('execution_journal_unversioned_schema');
  });

  it('rejects a versioned database with the wrong application identity', () => {
    const db = rawDatabase();
    db.execSync(`PRAGMA user_version = ${EXECUTION_JOURNAL_SCHEMA_VERSION}`);
    db.execSync('PRAGMA application_id = 123');
    expect(() => getExecutionJournalDb()).toThrow('execution_journal_application_id_mismatch');
  });

  it('rejects a claimed current version whose schema is incomplete', () => {
    const db = rawDatabase();
    db.execSync('CREATE TABLE execution_runs (id TEXT PRIMARY KEY)');
    db.execSync(`PRAGMA application_id = ${EXECUTION_JOURNAL_APPLICATION_ID}`);
    db.execSync(`PRAGMA user_version = ${EXECUTION_JOURNAL_SCHEMA_VERSION}`);
    expect(() => getExecutionJournalDb()).toThrow('execution_journal_schema_table_mismatch');
  });

  it('rejects extra user-defined schema objects in a claimed current schema', () => {
    const db = getExecutionJournalDb();
    db.execSync('CREATE INDEX unexpected_execution_index ON execution_runs(id)');
    closeExecutionJournalDb();
    expect(() => getExecutionJournalDb()).toThrow('execution_journal_schema_object_set_mismatch');
  });

  it('rejects an expected schema object whose definition was replaced', () => {
    const db = getExecutionJournalDb();
    db.execSync('DROP INDEX idx_execution_runs_status_updated');
    db.execSync('CREATE INDEX idx_execution_runs_status_updated ON execution_runs(status)');
    closeExecutionJournalDb();
    expect(() => getExecutionJournalDb()).toThrow(
      'execution_journal_schema_object_mismatch:idx_execution_runs_status_updated',
    );
  });

  it('migrates a populated exact v7 journal without losing unresolved recovery state', () => {
    const v8 = getExecutionJournalDb();
    seedPopulatedV8Database(v8);
    downgradePopulatedFixtureToV7(v8);
    const v7Effect = v8.getFirstSync<Record<string, unknown>>(
      'SELECT * FROM execution_effects WHERE id = ?',
      'effect-1',
    );
    expect(v7Effect).not.toHaveProperty('tool_contract_identity_digest');
    closeExecutionJournalDb();

    const migrated = getExecutionJournalDb();
    expect(
      migrated.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version,
    ).toBe(EXECUTION_JOURNAL_SCHEMA_VERSION);
    expect(migrated.getAllSync('PRAGMA foreign_key_check')).toEqual([]);
    expect(
      migrated
        .getAllSync<{ name: string }>(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND tbl_name = 'execution_effects'
             AND name NOT LIKE 'sqlite_autoindex_%'
           ORDER BY name`,
        )
        .map((row) => row.name),
    ).toEqual([...EFFECT_INDEX_NAMES].sort());
    expect(
      migrated
        .getAllSync<{ table: string }>('PRAGMA foreign_key_list(execution_external_handles)')
        .map((row) => row.table),
    ).toContain('execution_effects');
    expect(migrated.getFirstSync('SELECT * FROM execution_runs WHERE id = ?', 'run-1')).toEqual(
      expect.objectContaining({ id: 'run-1', status: 'ambiguous' }),
    );
    expect(
      migrated.getFirstSync(
        'SELECT * FROM execution_checkpoints WHERE id = ?',
        'checkpoint-effect',
      ),
    ).toEqual(expect.objectContaining({ run_id: 'run-1', sequence: 1 }));
    expect(
      migrated.getFirstSync('SELECT * FROM execution_effects WHERE id = ?', 'effect-1'),
    ).toEqual(
      expect.objectContaining({
        run_id: 'run-1',
        checkpoint_id: 'checkpoint-effect',
        status: 'ambiguous',
        tool_contract_identity_digest: null,
        model_authority_valid_until: null,
      }),
    );
    expect(
      migrated.getFirstSync('SELECT * FROM execution_external_handles WHERE id = ?', 'handle-1'),
    ).toEqual(expect.objectContaining({ effect_id: 'effect-1', status: 'pending' }));
    expect(
      migrated.getFirstSync('SELECT * FROM execution_monitors WHERE id = ?', 'monitor-1'),
    ).toEqual(expect.objectContaining({ external_handle_id: 'handle-1', state: 'armed' }));
    expect(() =>
      transitionExecutionRun({
        runId: 'run-1',
        expectedStatus: 'ambiguous',
        nextStatus: 'failed',
        expectedControlEpoch: 0,
        nextControlEpoch: 0,
        occurredAt: 15,
      }),
    ).toThrow('execution_journal_unresolved_work_prevents_terminal');
    expect(() => migrated.runSync('DELETE FROM execution_runs WHERE id = ?', 'run-1')).toThrow(
      'execution_journal_protected_run',
    );
  });

  it('rejects a structurally mismatched v7 journal without changing any durable state', () => {
    const v8 = getExecutionJournalDb();
    seedPopulatedV8Database(v8);
    downgradePopulatedFixtureToV7(v8);
    v8.execSync('DROP INDEX idx_execution_effects_run_status');
    v8.execSync(
      'CREATE INDEX idx_execution_effects_run_status ON execution_effects(status, run_id)',
    );
    const before = readDurableDatabaseSnapshot(v8);
    closeExecutionJournalDb();

    expect(() => getExecutionJournalDb()).toThrow(
      'execution_journal_v7_schema_object_mismatch:idx_execution_effects_run_status',
    );
    const unchanged = rawDatabase();
    expect(readDurableDatabaseSnapshot(unchanged)).toEqual(before);
    expect(
      unchanged
        .getAllSync<{ name: string }>('PRAGMA table_info(execution_effects)')
        .map((column) => column.name),
    ).not.toContain('tool_contract_identity_digest');
    expect(
      unchanged.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM sqlite_master
         WHERE type = 'table' AND name = 'execution_effects_v8'`,
      )?.count,
    ).toBe(0);
  });

  it('rejects a referentially corrupt v7 journal without changing any durable state', () => {
    const v8 = getExecutionJournalDb();
    seedPopulatedV8Database(v8);
    downgradePopulatedFixtureToV7(v8);
    v8.execSync('PRAGMA foreign_keys = OFF');
    v8.runSync(
      `UPDATE execution_external_handles
       SET run_id = 'missing-run'
       WHERE id = 'handle-1'`,
    );
    v8.execSync('PRAGMA foreign_keys = ON');
    expect(v8.getAllSync('PRAGMA foreign_key_check')).not.toEqual([]);
    const before = readDurableDatabaseSnapshot(v8);
    closeExecutionJournalDb();

    expect(() => getExecutionJournalDb()).toThrow('execution_journal_v7_foreign_key_mismatch');
    const unchanged = rawDatabase();
    expect(readDurableDatabaseSnapshot(unchanged)).toEqual(before);
    expect(
      unchanged
        .getAllSync<{ name: string }>('PRAGMA table_info(execution_effects)')
        .map((column) => column.name),
    ).not.toContain('tool_contract_identity_digest');
  });

  it('rolls back the entire migration when corrupt v7 data violates the v8 table', () => {
    const v8 = getExecutionJournalDb();
    seedPopulatedV8Database(v8);
    downgradePopulatedFixtureToV7(v8);
    v8.execSync('PRAGMA ignore_check_constraints = ON');
    v8.runSync(
      `UPDATE execution_effects
       SET tool_name_digest = 'corrupt'
       WHERE id = 'effect-1'`,
    );
    v8.execSync('PRAGMA ignore_check_constraints = OFF');
    const before = readDurableDatabaseSnapshot(v8);
    closeExecutionJournalDb();

    expect(() => getExecutionJournalDb()).toThrow(/CHECK constraint failed/u);
    const unchanged = rawDatabase();
    expect(readDurableDatabaseSnapshot(unchanged)).toEqual(before);
    expect(
      unchanged
        .getAllSync<{ name: string }>('PRAGMA table_info(execution_effects)')
        .map((column) => column.name),
    ).not.toContain('tool_contract_identity_digest');
    expect(
      unchanged.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM sqlite_master
         WHERE type = 'table' AND name = 'execution_effects_v8'`,
      )?.count,
    ).toBe(0);
  });
});
