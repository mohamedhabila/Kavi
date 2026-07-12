import * as SQLite from 'expo-sqlite';
import { removeRetiredMemoryDatabaseArtifacts } from './retiredMemoryArtifacts';

const MEMORY_DATABASE_NAME = 'kavi-memory.db';

let database: SQLite.SQLiteDatabase | null = null;

/** Delete retired tables without initializing canonical memory or retaining a new connection. */
export function removeRetiredMemoryDatabaseArtifactsAtStartup(): void {
  if (database) {
    removeRetiredMemoryDatabaseArtifacts(database);
    return;
  }

  const openedDatabase = SQLite.openDatabaseSync(MEMORY_DATABASE_NAME);
  let cleanupError: unknown;
  try {
    removeRetiredMemoryDatabaseArtifacts(openedDatabase);
  } catch (error) {
    cleanupError = error;
  }
  try {
    openedDatabase.closeSync();
  } catch (error) {
    cleanupError ??= error;
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
}

export function getMemoryDb(): SQLite.SQLiteDatabase {
  if (!database) {
    const openedDatabase = SQLite.openDatabaseSync(MEMORY_DATABASE_NAME);
    try {
      removeRetiredMemoryDatabaseArtifacts(openedDatabase);
      database = openedDatabase;
    } catch (error) {
      try {
        openedDatabase.closeSync();
      } catch {
        // Preserve the cleanup failure that prevented canonical database use.
      }
      throw error;
    }
  }
  return database;
}

export function closeMemoryDb(): void {
  if (!database) return;
  database.closeSync();
  database = null;
}
