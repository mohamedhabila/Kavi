import { Directory, Paths } from 'expo-file-system';
import type * as SQLite from 'expo-sqlite';

const RETIRED_MEMORY_DIRECTORY_NAMES = ['global-memory', 'conversation-memory'] as const;

/** Tables of retired memory stores: the chunk store, product experience, verified procedures. */
const RETIRED_MEMORY_TABLES = [
  'memory_chunks',
  'memory_product_experience_observations',
  'memory_verified_procedure_observations',
  'memory_verified_procedure_run_invalidations',
  'memory_verified_procedure_state',
  'memory_extraction_cursor',
] as const;

/**
 * Permanently remove the tables of retired memory stores. This is deletion-only: no data is
 * read or imported into canonical memory.
 */
export function removeRetiredMemoryDatabaseArtifacts(database: SQLite.SQLiteDatabase): void {
  for (const table of RETIRED_MEMORY_TABLES) {
    database.execSync(`DROP TABLE IF EXISTS ${table}`);
  }
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
