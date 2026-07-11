import * as SQLite from 'expo-sqlite';
import { removeRetiredMemoryDatabaseArtifacts } from './retiredMemoryArtifacts';

const MEMORY_DATABASE_NAME = 'kavi-memory.db';

let database: SQLite.SQLiteDatabase | null = null;

export function getMemoryDb(): SQLite.SQLiteDatabase {
  if (!database) {
    database = SQLite.openDatabaseSync(MEMORY_DATABASE_NAME);
    removeRetiredMemoryDatabaseArtifacts(database);
  }
  return database;
}

export function closeMemoryDb(): void {
  if (!database) return;
  database.closeSync();
  database = null;
}
