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
import {
  EXECUTION_JOURNAL_APPLICATION_ID,
  EXECUTION_JOURNAL_SCHEMA_VERSION,
} from '../../src/services/executionJournal/schema';
import { TABLE_NAMES } from '../../src/services/executionJournal/schemaDefinitions';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  openDatabaseSync: (name: string) => SQLite.SQLiteDatabase;
  __resetExpoSqliteForTests: () => void;
};

const rawDatabase = (): SQLite.SQLiteDatabase =>
  sqliteMock.openDatabaseSync(EXECUTION_JOURNAL_DATABASE_NAME);

function pragma(database: SQLite.SQLiteDatabase, name: string): unknown {
  return database.getFirstSync<Record<string, unknown>>(`PRAGMA ${name}`)?.[name];
}

function tableNames(database: SQLite.SQLiteDatabase): string[] {
  return database
    .getAllSync<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .map((row) => row.name);
}

function expectCurrentEmptySchema(database: SQLite.SQLiteDatabase): void {
  expect(pragma(database, 'user_version')).toBe(EXECUTION_JOURNAL_SCHEMA_VERSION);
  expect(pragma(database, 'application_id')).toBe(EXECUTION_JOURNAL_APPLICATION_ID);
  expect(tableNames(database)).toEqual([...TABLE_NAMES].sort());
  expect(database.getFirstSync('SELECT COUNT(*) AS count FROM execution_runs')).toEqual({
    count: 0,
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

describe('execution journal schema', () => {
  it('creates the current schema in a new journal', () => {
    expectCurrentEmptySchema(getExecutionJournalDb());
  });

  it.each([
    ['an older schema version', EXECUTION_JOURNAL_SCHEMA_VERSION - 1],
    ['a newer schema version', EXECUTION_JOURNAL_SCHEMA_VERSION + 1],
  ])('starts a journal written by %s over', (_label, version) => {
    const db = rawDatabase();
    db.execSync('CREATE TABLE execution_runs (id TEXT PRIMARY KEY)');
    db.execSync("INSERT INTO execution_runs (id) VALUES ('old-run')");
    db.execSync('CREATE TABLE legacy_runs (id TEXT PRIMARY KEY)');
    db.execSync(`PRAGMA application_id = ${EXECUTION_JOURNAL_APPLICATION_ID}`);
    db.execSync(`PRAGMA user_version = ${version}`);

    expectCurrentEmptySchema(getExecutionJournalDb());
  });

  it('starts over a database that is not this journal', () => {
    const db = rawDatabase();
    db.execSync('CREATE TABLE legacy_runs (id TEXT PRIMARY KEY)');
    db.execSync(`PRAGMA user_version = ${EXECUTION_JOURNAL_SCHEMA_VERSION}`);
    db.execSync('PRAGMA application_id = 123');

    expectCurrentEmptySchema(getExecutionJournalDb());
  });

  it('keeps the records of a current journal across reopening', () => {
    const db = getExecutionJournalDb();
    const before = tableNames(db);
    closeExecutionJournalDb();

    const reopened = getExecutionJournalDb();
    expect(tableNames(reopened)).toEqual(before);
    expect(pragma(reopened, 'user_version')).toBe(EXECUTION_JOURNAL_SCHEMA_VERSION);
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
});
