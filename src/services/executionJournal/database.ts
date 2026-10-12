import * as SQLite from 'expo-sqlite';
import { ensureExecutionJournalSchema } from './schema';

export const EXECUTION_JOURNAL_DATABASE_NAME = 'kavi-execution-journal.db';

let executionJournalDb: SQLite.SQLiteDatabase | null = null;

export function getExecutionJournalDb(): SQLite.SQLiteDatabase {
  if (executionJournalDb) {
    return executionJournalDb;
  }

  const database = SQLite.openDatabaseSync(EXECUTION_JOURNAL_DATABASE_NAME);
  try {
    ensureExecutionJournalSchema(database);
  } catch (error) {
    database.closeSync();
    throw error;
  }
  executionJournalDb = database;
  return database;
}

export function closeExecutionJournalDb(): void {
  if (!executionJournalDb) {
    return;
  }
  executionJournalDb.closeSync();
  executionJournalDb = null;
}
