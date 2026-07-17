import type * as SQLite from 'expo-sqlite';
import {
  CREATE_EXECUTION_EFFECTS,
  CREATE_EXECUTION_EFFECTS_V8,
} from './executionEffectSchema';
import {
  CREATE_EXECUTION_EFFECT_RECEIPTS,
  CREATE_EXECUTION_EFFECT_RECEIPT_UPDATE_GUARD,
} from './effectReceiptSchema';
import {
  SCHEMA_OBJECT_SQL,
  TABLE_NAMES,
  TRIGGER_NAMES,
  V7_SCHEMA_OBJECT_SQL,
  V8_SCHEMA_OBJECT_SQL,
  V9_SCHEMA_OBJECT_SQL,
  V9_TABLE_NAMES,
  V9_TRIGGER_NAMES,
} from './schemaDefinitions';

/** Keep synchronous native lock contention bounded on the mobile JS thread. */
export const EXECUTION_JOURNAL_BUSY_TIMEOUT_MS = 100;

export const EXECUTION_JOURNAL_SCHEMA_VERSION = 10;
export const EXECUTION_JOURNAL_APPLICATION_ID = 1_263_164_492;

function pragmaNumber(database: SQLite.SQLiteDatabase, name: string): number {
  const row = database.getFirstSync<Record<string, unknown>>(`PRAGMA ${name}`);
  const value = row?.[name];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`execution_journal_invalid_pragma:${name}`);
  }
  return value;
}

function userTableNames(database: SQLite.SQLiteDatabase): string[] {
  return database
    .getAllSync<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .map((row) => row.name);
}

function normalizeSql(value: string): string {
  return value
    .trim()
    .replace(/;$/, '')
    .replace(/"([A-Za-z_][A-Za-z0-9_]*)"/gu, '$1')
    .replace(/\s+/g, ' ');
}

function assertExactSchemaObjects(
  database: SQLite.SQLiteDatabase,
  expectedSchemaObjects: ReadonlyMap<string, string>,
  errorPrefix: string,
  expectedTableNames: readonly string[] = TABLE_NAMES,
  expectedTriggerNames: readonly string[] = TRIGGER_NAMES,
): void {
  const actualTables = userTableNames(database);
  const expectedTables = [...expectedTableNames].sort();
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    throw new Error(`${errorPrefix}_table_mismatch`);
  }

  const actualObjects = database
    .getAllSync<{ name: string; type: string }>(
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table', 'index', 'trigger', 'view')
         AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .map((row) => `${row.type}:${row.name}`)
    .sort();
  const expectedObjects = [...expectedSchemaObjects.keys()]
    .map((name) => {
      const type = expectedTableNames.includes(name)
        ? 'table'
        : expectedTriggerNames.includes(name)
          ? 'trigger'
          : 'index';
      return `${type}:${name}`;
    })
    .sort();
  if (JSON.stringify(actualObjects) !== JSON.stringify(expectedObjects)) {
    throw new Error(`${errorPrefix}_object_set_mismatch`);
  }

  for (const [name, expectedSql] of expectedSchemaObjects) {
    const row = database.getFirstSync<{ sql: string | null }>(
      `SELECT sql FROM sqlite_master
       WHERE name = ? AND type IN ('table', 'index', 'trigger')`,
      name,
    );
    if (!row?.sql || normalizeSql(row.sql) !== normalizeSql(expectedSql)) {
      throw new Error(`${errorPrefix}_object_mismatch:${name}`);
    }
  }
}

function assertNoForeignKeyViolations(database: SQLite.SQLiteDatabase, errorCode: string): void {
  if (database.getAllSync('PRAGMA foreign_key_check').length > 0) {
    throw new Error(errorCode);
  }
}

function assertExactSchema(database: SQLite.SQLiteDatabase): void {
  assertExactSchemaObjects(database, SCHEMA_OBJECT_SQL, 'execution_journal_schema');

  const foreignKeysEnabled = pragmaNumber(database, 'foreign_keys');
  if (foreignKeysEnabled !== 1) {
    throw new Error('execution_journal_foreign_keys_disabled');
  }
  assertNoForeignKeyViolations(database, 'execution_journal_foreign_key_mismatch');
}

function createFreshSchema(database: SQLite.SQLiteDatabase): void {
  database.execSync('BEGIN IMMEDIATE');
  try {
    for (const sql of SCHEMA_OBJECT_SQL.values()) {
      database.execSync(sql);
    }
    database.execSync(`PRAGMA application_id = ${EXECUTION_JOURNAL_APPLICATION_ID}`);
    database.execSync(`PRAGMA user_version = ${EXECUTION_JOURNAL_SCHEMA_VERSION}`);
    database.execSync('COMMIT');
  } catch (error) {
    try {
      database.execSync('ROLLBACK');
    } catch {
      // Preserve the original schema error.
    }
    throw error;
  }
}

function migrateV7ToV8(database: SQLite.SQLiteDatabase): void {
  if (pragmaNumber(database, 'application_id') !== EXECUTION_JOURNAL_APPLICATION_ID) {
    throw new Error('execution_journal_application_id_mismatch');
  }
  assertExactSchemaObjects(
    database,
    V7_SCHEMA_OBJECT_SQL,
    'execution_journal_v7_schema',
    V9_TABLE_NAMES,
    V9_TRIGGER_NAMES,
  );
  assertNoForeignKeyViolations(database, 'execution_journal_v7_foreign_key_mismatch');

  const temporaryTable = 'execution_effects_v8';
  const createTemporaryTable = CREATE_EXECUTION_EFFECTS_V8.replace(
    'CREATE TABLE execution_effects',
    `CREATE TABLE ${temporaryTable}`,
  );
  database.execSync('PRAGMA foreign_keys = OFF');
  database.execSync('PRAGMA legacy_alter_table = ON');
  try {
    database.execSync('BEGIN IMMEDIATE');
    database.execSync(createTemporaryTable);
    database.execSync(
      `INSERT INTO ${temporaryTable} (
         id, run_id, checkpoint_id, tool_call_id, tool_name_digest,
         tool_contract_identity_digest, effect_class, idempotency_class,
         idempotency_key_digest, request_digest, outcome_digest, status,
         retry_policy, attempt, created_at, started_at, completed_at, updated_at
       )
       SELECT id, run_id, checkpoint_id, tool_call_id, tool_name_digest,
              NULL, effect_class, idempotency_class, idempotency_key_digest,
              request_digest, outcome_digest, status, retry_policy, attempt,
              created_at, started_at, completed_at, updated_at
         FROM execution_effects`,
    );
    database.execSync('DROP TABLE execution_effects');
    database.execSync(`ALTER TABLE ${temporaryTable} RENAME TO execution_effects`);
    for (const name of [
      'idx_execution_effects_run_status',
      'idx_execution_effects_status_run',
      'ux_execution_effects_idempotency_key',
    ]) {
      const sql = SCHEMA_OBJECT_SQL.get(name);
      if (!sql) throw new Error(`execution_journal_v8_index_missing:${name}`);
      database.execSync(sql);
    }
    assertExactSchemaObjects(
      database,
      V8_SCHEMA_OBJECT_SQL,
      'execution_journal_v8_schema',
      V9_TABLE_NAMES,
      V9_TRIGGER_NAMES,
    );
    assertNoForeignKeyViolations(database, 'execution_journal_v8_foreign_key_mismatch');
    database.execSync('PRAGMA user_version = 8');
    database.execSync('COMMIT');
  } catch (error) {
    try {
      database.execSync('ROLLBACK');
    } catch {
      // Preserve the migration error.
    }
    throw error;
  } finally {
    database.execSync('PRAGMA legacy_alter_table = OFF');
    database.execSync('PRAGMA foreign_keys = ON');
  }
}

function migrateV8ToV9(database: SQLite.SQLiteDatabase): void {
  if (pragmaNumber(database, 'application_id') !== EXECUTION_JOURNAL_APPLICATION_ID) {
    throw new Error('execution_journal_application_id_mismatch');
  }
  assertExactSchemaObjects(
    database,
    V8_SCHEMA_OBJECT_SQL,
    'execution_journal_v8_schema',
    V9_TABLE_NAMES,
    V9_TRIGGER_NAMES,
  );
  assertNoForeignKeyViolations(database, 'execution_journal_v8_foreign_key_mismatch');

  const temporaryTable = 'execution_effects_v9';
  const createTemporaryTable = CREATE_EXECUTION_EFFECTS.replace(
    'CREATE TABLE execution_effects',
    `CREATE TABLE ${temporaryTable}`,
  );
  database.execSync('PRAGMA foreign_keys = OFF');
  database.execSync('PRAGMA legacy_alter_table = ON');
  try {
    database.execSync('BEGIN IMMEDIATE');
    database.execSync(createTemporaryTable);
    database.execSync(
      `INSERT INTO ${temporaryTable} (
         id, run_id, checkpoint_id, tool_call_id, tool_name_digest,
         tool_contract_identity_digest, effect_class, idempotency_class,
         idempotency_key_digest, request_digest, model_authority_valid_until,
         outcome_digest, status, retry_policy, attempt, created_at, started_at,
         completed_at, updated_at
       )
       SELECT id, run_id, checkpoint_id, tool_call_id, tool_name_digest,
              tool_contract_identity_digest, effect_class, idempotency_class,
              idempotency_key_digest, request_digest, NULL, outcome_digest,
              status, retry_policy, attempt, created_at, started_at,
              completed_at, updated_at
         FROM execution_effects`,
    );
    database.execSync('DROP TABLE execution_effects');
    database.execSync(`ALTER TABLE ${temporaryTable} RENAME TO execution_effects`);
    for (const name of [
      'idx_execution_effects_run_status',
      'idx_execution_effects_status_run',
      'ux_execution_effects_idempotency_key',
    ]) {
      const sql = SCHEMA_OBJECT_SQL.get(name);
      if (!sql) throw new Error(`execution_journal_v9_index_missing:${name}`);
      database.execSync(sql);
    }
    assertExactSchemaObjects(
      database,
      V9_SCHEMA_OBJECT_SQL,
      'execution_journal_v9_schema',
      V9_TABLE_NAMES,
      V9_TRIGGER_NAMES,
    );
    assertNoForeignKeyViolations(database, 'execution_journal_v9_foreign_key_mismatch');
    database.execSync('PRAGMA user_version = 9');
    database.execSync('COMMIT');
  } catch (error) {
    try {
      database.execSync('ROLLBACK');
    } catch {
      // Preserve the migration error.
    }
    throw error;
  } finally {
    database.execSync('PRAGMA legacy_alter_table = OFF');
    database.execSync('PRAGMA foreign_keys = ON');
  }
}

function migrateV9ToV10(database: SQLite.SQLiteDatabase): void {
  if (pragmaNumber(database, 'application_id') !== EXECUTION_JOURNAL_APPLICATION_ID) {
    throw new Error('execution_journal_application_id_mismatch');
  }
  assertExactSchemaObjects(
    database,
    V9_SCHEMA_OBJECT_SQL,
    'execution_journal_v9_schema',
    V9_TABLE_NAMES,
    V9_TRIGGER_NAMES,
  );
  assertNoForeignKeyViolations(database, 'execution_journal_v9_foreign_key_mismatch');

  database.execSync('BEGIN IMMEDIATE');
  try {
    database.execSync(CREATE_EXECUTION_EFFECT_RECEIPTS);
    database.execSync(CREATE_EXECUTION_EFFECT_RECEIPT_UPDATE_GUARD);
    database.execSync(`PRAGMA user_version = ${EXECUTION_JOURNAL_SCHEMA_VERSION}`);
    assertExactSchemaObjects(database, SCHEMA_OBJECT_SQL, 'execution_journal_schema');
    assertNoForeignKeyViolations(database, 'execution_journal_v10_foreign_key_mismatch');
    database.execSync('COMMIT');
  } catch (error) {
    try {
      database.execSync('ROLLBACK');
    } catch {
      // Preserve the original migration error.
    }
    throw error;
  }
}

export function ensureExecutionJournalSchema(database: SQLite.SQLiteDatabase): void {
  database.execSync('PRAGMA foreign_keys = ON');
  database.execSync(`PRAGMA busy_timeout = ${EXECUTION_JOURNAL_BUSY_TIMEOUT_MS}`);

  let version = pragmaNumber(database, 'user_version');
  const applicationId = pragmaNumber(database, 'application_id');
  if (version === 0) {
    if (applicationId !== 0 || userTableNames(database).length > 0) {
      throw new Error('execution_journal_unversioned_schema');
    }
    createFreshSchema(database);
    version = EXECUTION_JOURNAL_SCHEMA_VERSION;
  } else if (version === 7) {
    migrateV7ToV8(database);
    version = 8;
  }
  if (version === 8) {
    migrateV8ToV9(database);
    version = 9;
  }
  if (version === 9) {
    migrateV9ToV10(database);
    version = EXECUTION_JOURNAL_SCHEMA_VERSION;
  }
  if (version !== EXECUTION_JOURNAL_SCHEMA_VERSION) {
    throw new Error(`execution_journal_unsupported_schema_version:${version}`);
  }

  if (pragmaNumber(database, 'application_id') !== EXECUTION_JOURNAL_APPLICATION_ID) {
    throw new Error('execution_journal_application_id_mismatch');
  }
  assertExactSchema(database);
}
