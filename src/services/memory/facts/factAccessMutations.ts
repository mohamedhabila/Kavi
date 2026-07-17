import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import {
  isMemoryTransactionActive,
  runAfterMemoryTransactionCommit,
  runMemoryTransaction,
} from '../access/transaction';
import { notifyStructuredMemoryChanged } from '../changeNotifications';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import {
  advanceMemoryProjectionInTransaction,
  advanceRestrictiveMemoryAuthorityInTransaction,
  type MemoryAuthoritySnapshot,
} from '../memoryAuthority';
import {
  isMemoryAuthoritySnapshotShape,
  isMemoryProjectionProcessEpochCurrent,
  isRestrictiveMemoryAuthorityProcessEpochCurrent,
  readDurableMemoryPolicyState,
  readMemoryAuthorityProcessEpochs,
  readMemoryAuthorityRevisions,
} from '../memoryAuthorityState';
import {
  requireCurrentLocalSimilarityVector,
  serializeCurrentLocalSimilarityVector,
  type LocalSimilarityVector,
} from '../localSimilarity';
import { requireFactMutationTimestamp } from './mutationValidation';

export interface FactRecallMutationResult {
  status: 'updated' | 'unchanged' | 'authority_stale';
  changedCount: number;
  /** Exact post-commit continuation; absent inside caller-owned transactions. */
  authorityContinuation: MemoryAuthoritySnapshot | null;
}

interface FactRecallContinuationDraft {
  restrictiveRevision: MemoryAuthoritySnapshot['restrictiveRevision'];
  projectionRevision: MemoryAuthoritySnapshot['projectionRevision'];
  policy: MemoryAuthoritySnapshot['policy'];
}

function expectedAuthorityIsCurrent(
  db: ReturnType<typeof getSchemaReadyMemoryDb>,
  memoryOwnerId: string,
  expected: MemoryAuthoritySnapshot,
): boolean {
  if (
    !isMemoryAuthoritySnapshotShape(expected) ||
    expected.restrictiveRevision.memoryOwnerId !== memoryOwnerId ||
    !isRestrictiveMemoryAuthorityProcessEpochCurrent(expected.processEpochs.restrictive) ||
    !isMemoryProjectionProcessEpochCurrent(expected.processEpochs.projection)
  ) {
    return false;
  }
  const revisions = readMemoryAuthorityRevisions(db, memoryOwnerId);
  const policy = readDurableMemoryPolicyState(db, memoryOwnerId);
  return (
    policy.enabled &&
    policy.revision === expected.policy.revision &&
    revisions.restrictive.value === expected.restrictiveRevision.value &&
    revisions.projection.value === expected.projectionRevision.value
  );
}

function buildAuthorityContinuation(draft: FactRecallContinuationDraft): MemoryAuthoritySnapshot {
  const processEpochs = readMemoryAuthorityProcessEpochs();
  return Object.freeze({
    processEpochs: Object.freeze({ ...processEpochs }),
    restrictiveRevision: Object.freeze({ ...draft.restrictiveRevision }),
    projectionRevision: Object.freeze({ ...draft.projectionRevision }),
    policy: Object.freeze({ ...draft.policy, enabled: true as const }),
  });
}

export function markFactsRecalled(
  ids: string[],
  now = Date.now(),
  options: { expectedAuthoritySnapshot?: MemoryAuthoritySnapshot } = {},
): FactRecallMutationResult {
  requireFactMutationTimestamp(now, 'memory_fact_mutation_clock_invalid');
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return { status: 'unchanged', changedCount: 0, authorityContinuation: null };
  }
  const callerOwnsTransaction = isMemoryTransactionActive();
  const mutation = runMemoryTransaction(
    (): {
      status: FactRecallMutationResult['status'];
      changedCount: number;
      continuationDraft: FactRecallContinuationDraft | null;
    } => {
      const db = getSchemaReadyMemoryDb();
      const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
      if (
        options.expectedAuthoritySnapshot &&
        !expectedAuthorityIsCurrent(db, memoryOwnerId, options.expectedAuthoritySnapshot)
      ) {
        return { status: 'authority_stale', changedCount: 0, continuationDraft: null };
      }
      const result = db.runSync(
        `UPDATE memory_facts
         SET access_count = access_count + 1,
             last_recalled_at = ?,
             last_accessed_at = ?,
             updated_at = ?
         WHERE id IN (${uniqueIds.map(() => '?').join(', ')})
           AND memory_owner_id = ?
           AND deleted_at IS NULL`,
        now,
        now,
        now,
        ...uniqueIds,
        memoryOwnerId,
      );
      const changed = result.changes ?? 0;
      if (changed === 0) {
        return { status: 'unchanged', changedCount: 0, continuationDraft: null };
      }
      advanceMemoryProjectionInTransaction(db, memoryOwnerId);
      const continuationDraft = options.expectedAuthoritySnapshot
        ? (() => {
            const revisions = readMemoryAuthorityRevisions(db, memoryOwnerId);
            const policy = readDurableMemoryPolicyState(db, memoryOwnerId);
            if (!policy.enabled) return null;
            return {
              restrictiveRevision: revisions.restrictive,
              projectionRevision: revisions.projection,
              policy: Object.freeze({ enabled: true as const, revision: policy.revision }),
            };
          })()
        : null;
      return { status: 'updated', changedCount: changed, continuationDraft };
    },
  );
  return {
    status: mutation.status,
    changedCount: mutation.changedCount,
    authorityContinuation:
      !callerOwnsTransaction && mutation.continuationDraft
        ? buildAuthorityContinuation(mutation.continuationDraft)
        : null,
  };
}

/** Persist one current, validated local-similarity vector for a fact. */
export function setFactLocalSimilarity(
  id: string,
  localSimilarity: LocalSimilarityVector,
  now = Date.now(),
): boolean {
  requireFactMutationTimestamp(now, 'memory_fact_mutation_clock_invalid');
  const validated = requireCurrentLocalSimilarityVector(localSimilarity);
  const serialized = serializeCurrentLocalSimilarityVector(validated);
  return runMemoryTransaction(() => {
    const db = getSchemaReadyMemoryDb();
    const existing = db.getFirstSync<{
      local_similarity_model: string | null;
      local_similarity_dimensions: number | null;
      local_similarity_vector: string | null;
      local_similarity_updated_at: number | null;
    }>(
      `SELECT local_similarity_model, local_similarity_dimensions, local_similarity_vector,
              local_similarity_updated_at
         FROM memory_facts
        WHERE id = ? AND deleted_at IS NULL`,
      id,
    );
    if (!existing) return false;
    const vectorChanged = !(
      existing.local_similarity_model === validated.model &&
      existing.local_similarity_dimensions === validated.dimensions &&
      existing.local_similarity_vector === serialized
    );
    if (!vectorChanged && existing.local_similarity_updated_at === now) {
      return false;
    }
    const result = db.runSync(
      `UPDATE memory_facts
         SET local_similarity_model = ?,
             local_similarity_dimensions = ?,
             local_similarity_vector = ?,
             local_similarity_updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      validated.model,
      validated.dimensions,
      serialized,
      now,
      id,
    );
    if ((result.changes ?? 0) !== 1) return false;
    if (vectorChanged) {
      const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
      const replacedCurrentVector =
        existing.local_similarity_model === validated.model &&
        existing.local_similarity_dimensions === validated.dimensions &&
        existing.local_similarity_vector !== null;
      if (replacedCurrentVector) {
        advanceRestrictiveMemoryAuthorityInTransaction(db, memoryOwnerId);
      } else {
        advanceMemoryProjectionInTransaction(db, memoryOwnerId);
      }
    }
    runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged());
    return true;
  });
}
