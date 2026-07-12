import { removeRetiredMemoryDatabaseArtifactsAtStartup } from './database';
import { removeRetiredMemoryFileArtifacts } from './retiredMemoryArtifacts';

/** Attempt every deletion-only cleanup and preserve the first failure for retry. */
export function removeRetiredMemoryArtifacts(): void {
  const failures: unknown[] = [];
  for (const cleanup of [
    removeRetiredMemoryDatabaseArtifactsAtStartup,
    removeRetiredMemoryFileArtifacts,
  ]) {
    try {
      cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw failures[0];
  }
}
