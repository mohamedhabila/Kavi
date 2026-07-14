import { runMemoryStatement } from '../access/crud';
import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { runAfterMemoryTransactionCommit } from '../access/transaction';
import { notifyStructuredMemoryChanged } from '../changeNotifications';
import {
  requireCurrentLocalSimilarityVector,
  serializeCurrentLocalSimilarityVector,
  type LocalSimilarityVector,
} from '../localSimilarity';
import { requireFactMutationTimestamp } from './mutationValidation';

export function markFactsRecalled(ids: string[], now = Date.now()): number {
  requireFactMutationTimestamp(now, 'memory_fact_mutation_clock_invalid');
  getSchemaReadyMemoryDb();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return 0;
  const result = runMemoryStatement(
    `UPDATE memory_facts
       SET access_count = access_count + 1,
           last_recalled_at = ?,
           last_accessed_at = ?,
           updated_at = ?
       WHERE id IN (${uniqueIds.map(() => '?').join(', ')})
         AND deleted_at IS NULL`,
    now,
    now,
    now,
    ...uniqueIds,
  );
  return result.changes ?? 0;
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
  const result = runMemoryStatement(
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
  const changed = (result.changes ?? 0) > 0;
  if (changed) runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged());
  return changed;
}
