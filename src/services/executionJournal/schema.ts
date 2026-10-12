import type * as SQLite from 'expo-sqlite';
import { SCHEMA_OBJECT_SQL, TABLE_NAMES, TRIGGER_NAMES } from './schemaDefinitions';

/** Keep synchronous native lock contention bounded on the mobile JS thread. */
export const EXECUTION_JOURNAL_BUSY_TIMEOUT_MS = 100;

export const EXECUTION_JOURNAL_SCHEMA_VERSION = 13;
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

/** The journal must hold exactly the current schema's tables, indexes and triggers. */
function assertExactSchema(database: SQLite.SQLiteDatabase): void {
  const tableNames: readonly string[] = TABLE_NAMES;
  const triggerNames: readonly string[] = TRIGGER_NAMES;
  if (JSON.stringify(userTableNames(database)) !== JSON.stringify([...tableNames].sort())) {
    throw new Error('execution_journal_schema_table_mismatch');
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
  const expectedObjects = [...SCHEMA_OBJECT_SQL.keys()]
    .map((name) => {
      const type = tableNames.includes(name)
        ? 'table'
        : triggerNames.includes(name)
          ? 'trigger'
          : 'index';
      return `${type}:${name}`;
    })
    .sort();
  if (JSON.stringify(actualObjects) !== JSON.stringify(expectedObjects)) {
    throw new Error('execution_journal_schema_object_set_mismatch');
  }

  for (const [name, expectedSql] of SCHEMA_OBJECT_SQL) {
    const row = database.getFirstSync<{ sql: string | null }>(
      `SELECT sql FROM sqlite_master
       WHERE name = ? AND type IN ('table', 'index', 'trigger')`,
      name,
    );
    if (!row?.sql || normalizeSql(row.sql) !== normalizeSql(expectedSql)) {
      throw new Error(`execution_journal_schema_object_mismatch:${name}`);
    }
  }
}

/**
 * The journal records this install's executions. Fresh installs create it; a journal written
 * by another schema version is dropped and created again rather than migrated (pre-release:
 * there are no users' journals to carry forward).
 */
function recreateSchema(database: SQLite.SQLiteDatabase): void {
  database.execSync('PRAGMA foreign_keys = OFF');
  try {
    database.execSync('BEGIN IMMEDIATE');
    try {
      for (const name of userTableNames(database)) {
        database.execSync(`DROP TABLE "${name}"`);
      }
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
  } finally {
    database.execSync('PRAGMA foreign_keys = ON');
  }
}

export function ensureExecutionJournalSchema(database: SQLite.SQLiteDatabase): void {
  database.execSync('PRAGMA foreign_keys = ON');
  database.execSync(`PRAGMA busy_timeout = ${EXECUTION_JOURNAL_BUSY_TIMEOUT_MS}`);

  if (
    pragmaNumber(database, 'user_version') !== EXECUTION_JOURNAL_SCHEMA_VERSION ||
    pragmaNumber(database, 'application_id') !== EXECUTION_JOURNAL_APPLICATION_ID
  ) {
    recreateSchema(database);
  }
  assertExactSchema(database);
  if (pragmaNumber(database, 'foreign_keys') !== 1) {
    throw new Error('execution_journal_foreign_keys_disabled');
  }
  if (database.getAllSync('PRAGMA foreign_key_check').length > 0) {
    throw new Error('execution_journal_foreign_key_mismatch');
  }
}
