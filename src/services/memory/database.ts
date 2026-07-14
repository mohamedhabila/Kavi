import * as SQLite from 'expo-sqlite';
import { removeRetiredMemoryDatabaseArtifacts } from './retiredMemoryArtifacts';

const MEMORY_DATABASE_NAME = 'kavi-memory.db';

let database: SQLite.SQLiteDatabase | null = null;

function configureMemoryDatabasePrivacy(db: SQLite.SQLiteDatabase): void {
  db.execSync('PRAGMA secure_delete = ON');
  const configured = db.getFirstSync<{ secure_delete: number }>('PRAGMA secure_delete');
  if (configured?.secure_delete !== 1) {
    throw new Error('memory_database_secure_delete_unavailable');
  }
}

/**
 * Flush scrubbed pages and truncate a WAL when the connection uses one.
 * SQLite cannot guarantee erasure from device snapshots, backups, or flash
 * wear-levelled copies; those boundaries require storage-level encryption.
 */
export function checkpointMemoryDatabaseAfterSensitiveDeletion(): void {
  if (!database) return;
  database.execSync('PRAGMA wal_checkpoint(TRUNCATE)');
}

/** Delete retired tables without initializing canonical memory or retaining a new connection. */
export function removeRetiredMemoryDatabaseArtifactsAtStartup(): void {
  if (database) {
    removeRetiredMemoryDatabaseArtifacts(database);
    return;
  }

  const openedDatabase = SQLite.openDatabaseSync(MEMORY_DATABASE_NAME);
  let cleanupError: unknown;
  try {
    configureMemoryDatabasePrivacy(openedDatabase);
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
      configureMemoryDatabasePrivacy(openedDatabase);
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
