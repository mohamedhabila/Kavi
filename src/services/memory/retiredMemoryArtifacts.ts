import { Directory, Paths } from 'expo-file-system';
import type * as SQLite from 'expo-sqlite';

const RETIRED_MEMORY_DIRECTORY_NAMES = ['global-memory', 'conversation-memory'] as const;

/**
 * Permanently remove the table used by the retired chunk-based memory store.
 * This is deletion-only: no data is read or imported into canonical memory.
 */
export function removeRetiredMemoryDatabaseArtifacts(database: SQLite.SQLiteDatabase): void {
  database.execSync('DROP TABLE IF EXISTS memory_chunks');
}

/**
 * Permanently remove the file trees used by the retired Markdown memory store.
 * Canonical memory is stored exclusively in the structured memory database.
 */
export function removeRetiredMemoryFileArtifacts(): void {
  const failures: unknown[] = [];
  for (const name of RETIRED_MEMORY_DIRECTORY_NAMES) {
    try {
      const directory = new Directory(Paths.document, name);
      if (directory.exists) {
        directory.delete();
      }
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw failures[0];
  }
}
