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

const sqliteMock = jest.requireMock('expo-sqlite') as {
  openDatabaseSync: (name: string) => SQLite.SQLiteDatabase;
  __resetExpoSqliteForTests: () => void;
};

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
});
