import { isExactMemoryProvenanceId } from '../memoryProvenanceIdentity';
import { runMemoryTransaction } from '../access/transaction';
import { getMemoryDb } from '../database';
import { ensureFactSchema } from '../schema';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { isExactMemoryScopeId } from '../memoryScopeIdentity';
import {
  advanceRestrictiveVerifiedProcedureAuthorityInTransaction,
  type VerifiedProcedureRestrictiveAuthorityRevision,
} from './observationAuthority';
import { hashVerifiedProcedureProvenanceSync } from './provenanceHash';

const RAW_SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function hasVerifiedProcedureRunInvalidationFence(params: {
  db: ReturnType<typeof getMemoryDb>;
  memoryOwnerId: string;
  sourceRunIdHash: string;
}): boolean {
  const row = params.db.getFirstSync<{
    invalidated_at: unknown;
    restrictive_authority_revision: unknown;
  }>(
    `SELECT invalidated_at, restrictive_authority_revision
       FROM memory_verified_procedure_run_invalidations
      WHERE memory_owner_id = ? AND source_run_id_hash = ?`,
    params.memoryOwnerId,
    params.sourceRunIdHash,
  );
  if (!row) return false;
  if (
    !Number.isSafeInteger(row.invalidated_at) ||
    (row.invalidated_at as number) < 0 ||
    !Number.isSafeInteger(row.restrictive_authority_revision) ||
    (row.restrictive_authority_revision as number) < 1
  ) {
    throw new Error('verified_procedure_run_invalidation_invalid');
  }
  return true;
}

/**
 * Transaction-safe content-free fence used by targeted invalidation and
 * withdrawal. The caller owns the surrounding transaction; any invalid hash
 * throws so deletion cannot commit without its matching monotonic fence.
 */
export function fenceVerifiedProcedureExecutionRunHashes(params: {
  db: ReturnType<typeof getMemoryDb>;
  memoryOwnerId: string;
  sourceRunIdHashes: readonly string[];
  invalidatedAt: number;
}): VerifiedProcedureRestrictiveAuthorityRevision | null {
  if (
    !isExactMemoryScopeId(params.memoryOwnerId) ||
    !Number.isSafeInteger(params.invalidatedAt) ||
    params.invalidatedAt < 0 ||
    params.sourceRunIdHashes.some((hash) => !RAW_SHA256_PATTERN.test(hash))
  ) {
    throw new Error('verified_procedure_invalidation_fence_invalid');
  }
  const hashes = [...new Set(params.sourceRunIdHashes)].sort();
  if (hashes.length === 0) return null;
  const revision = advanceRestrictiveVerifiedProcedureAuthorityInTransaction(
    params.db,
    params.memoryOwnerId,
  ).restrictive;
  for (const sourceRunIdHash of hashes) {
    params.db.runSync(
      `INSERT INTO memory_verified_procedure_run_invalidations(
         memory_owner_id, source_run_id_hash, invalidated_at, restrictive_authority_revision
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(memory_owner_id, source_run_id_hash) DO UPDATE SET
         invalidated_at = MAX(invalidated_at, excluded.invalidated_at),
         restrictive_authority_revision = excluded.restrictive_authority_revision`,
      params.memoryOwnerId,
      sourceRunIdHash,
      params.invalidatedAt,
      revision.value,
    );
  }
  return revision;
}

export type InvalidateVerifiedProcedureRunResult =
  | { status: 'invalidated'; deletedCount: number }
  | { status: 'rejected'; code: 'invalid_execution_run_id' }
  | { status: 'failed'; code: 'storage_error' };

/** Deletes derived success evidence for one exact execution; it never records failure evidence. */
export function invalidateVerifiedProcedureObservationsForExecutionRun(
  executionRunId: string,
): InvalidateVerifiedProcedureRunResult {
  if (!isExactMemoryProvenanceId(executionRunId)) {
    return { status: 'rejected', code: 'invalid_execution_run_id' };
  }
  try {
    ensureFactSchema();
    const invalidatedAt = Date.now();
    if (!Number.isSafeInteger(invalidatedAt) || invalidatedAt < 0) {
      return { status: 'failed', code: 'storage_error' };
    }
    const sourceRunIdHash = hashVerifiedProcedureProvenanceSync('source-run', executionRunId);
    const db = getMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    const deletedCount = runMemoryTransaction(() => {
      fenceVerifiedProcedureExecutionRunHashes({
        db,
        memoryOwnerId,
        sourceRunIdHashes: [sourceRunIdHash],
        invalidatedAt,
      });
      return (
        db.runSync(
          `DELETE FROM memory_verified_procedure_observations
            WHERE memory_owner_id = ? AND source_run_id_hash = ?`,
          memoryOwnerId,
          sourceRunIdHash,
        ).changes ?? 0
      );
    });
    return { status: 'invalidated', deletedCount };
  } catch {
    return { status: 'failed', code: 'storage_error' };
  }
}
