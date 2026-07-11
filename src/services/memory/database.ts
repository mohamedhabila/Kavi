import * as SQLite from 'expo-sqlite';
import { removeRetiredMemoryDatabaseArtifacts } from './retiredMemoryArtifacts';

const MEMORY_DATABASE_NAME = 'kavi-memory.db';

let database: SQLite.SQLiteDatabase | null = null;

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
