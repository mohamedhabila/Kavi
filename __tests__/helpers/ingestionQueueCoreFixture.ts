import { getMemoryDb } from '../../src/services/memory/database';
import { captureMemoryAuthoritySnapshot } from '../../src/services/memory/memoryAuthority';

export function columnNamesForQueue(): string[] {
  return getMemoryDb()
    .getAllSync<{ name: string }>('PRAGMA table_info(memory_ingestion_jobs)')
    .map((column) => column.name);
}

export function requireAuthoritySnapshot() {
  const snapshot = captureMemoryAuthoritySnapshot();
  if (!snapshot) throw new Error('expected memory authority snapshot');
  return snapshot;
}
