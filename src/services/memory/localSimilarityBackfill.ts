import { createLogger } from '../../utils/logger';
import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import { runAfterMemoryTransactionCommit, runMemoryTransaction } from './access/transaction';
import { requireFactMutationTimestamp } from './facts/mutationValidation';
import {
  buildFactLocalSimilarityText,
  createCurrentLocalSimilarityVector,
  LOCAL_SIMILARITY_DIMENSIONS,
  LOCAL_SIMILARITY_MODEL,
} from './localSimilarity';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { notifyStructuredMemoryChanged } from './store';

const logger = createLogger('memory.localSimilarityBackfill');
const DEFAULT_BACKFILL_LIMIT = 16;
const MAXIMUM_BACKFILL_LIMIT = 64;

type BackfillRow = {
  id: string;
  predicate: string;
  object_text: string;
  source_summary: string | null;
};

export interface LocalSimilarityDiagnostics {
  model: typeof LOCAL_SIMILARITY_MODEL;
  dimensions: typeof LOCAL_SIMILARITY_DIMENSIONS;
  currentFactCount: number;
  currentVectorCount: number;
  pendingVectorCount: number;
}

export interface LocalSimilarityBackfillResult {
  processedCount: number;
  hasMore: boolean;
  model: typeof LOCAL_SIMILARITY_MODEL;
  dimensions: typeof LOCAL_SIMILARITY_DIMENSIONS;
}

const CURRENT_VECTOR_SQL = `
  local_similarity_model = ?
  AND local_similarity_dimensions = ?
  AND local_similarity_vector IS NOT NULL
  AND local_similarity_updated_at IS NOT NULL
  AND local_similarity_updated_at >= 0
  AND json_valid(local_similarity_vector) = 1
  AND json_type(
    CASE WHEN json_valid(local_similarity_vector) = 1 THEN local_similarity_vector ELSE 'null' END
  ) = 'array'
  AND json_array_length(
    CASE WHEN json_valid(local_similarity_vector) = 1 THEN local_similarity_vector ELSE '[]' END
  ) = ?
  AND NOT EXISTS (
    SELECT 1
      FROM json_each(
        CASE WHEN json_valid(local_similarity_vector) = 1 THEN local_similarity_vector ELSE '[]' END
      )
     WHERE type NOT IN ('integer', 'real')
  )
`;

function normalizeBackfillLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BACKFILL_LIMIT;
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('memory_local_similarity_backfill_limit_invalid');
  }
  return Math.min(Math.floor(value), MAXIMUM_BACKFILL_LIMIT);
}

function currentFactWhereSql(): string {
  return `memory_owner_id = ?
    AND invalid_at IS NULL
    AND deleted_at IS NULL
    AND (expires_at IS NULL OR expires_at > ?)`;
}

export function getLocalSimilarityDiagnostics(now = Date.now()): LocalSimilarityDiagnostics {
  const asOf = requireFactMutationTimestamp(now, 'memory_local_similarity_clock_invalid');
  const db = getSchemaReadyMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const row = db.getFirstSync<{ current_fact_count: number; current_vector_count: number }>(
    `SELECT COUNT(*) AS current_fact_count,
            COALESCE(SUM(CASE WHEN ${CURRENT_VECTOR_SQL} THEN 1 ELSE 0 END), 0)
              AS current_vector_count
       FROM memory_facts
      WHERE ${currentFactWhereSql()}`,
    LOCAL_SIMILARITY_MODEL,
    LOCAL_SIMILARITY_DIMENSIONS,
    LOCAL_SIMILARITY_DIMENSIONS,
    memoryOwnerId,
    asOf,
  );
  const currentFactCount = Math.max(0, row?.current_fact_count ?? 0);
  const currentVectorCount = Math.max(0, row?.current_vector_count ?? 0);
  return {
    model: LOCAL_SIMILARITY_MODEL,
    dimensions: LOCAL_SIMILARITY_DIMENSIONS,
    currentFactCount,
    currentVectorCount,
    pendingVectorCount: Math.max(0, currentFactCount - currentVectorCount),
  };
}

export function backfillCurrentFactLocalSimilarity(
  input: {
    limit?: number;
    now?: number;
  } = {},
): LocalSimilarityBackfillResult {
  const limit = normalizeBackfillLimit(input.limit);
  const now = requireFactMutationTimestamp(
    input.now ?? Date.now(),
    'memory_local_similarity_clock_invalid',
  );
  return runMemoryTransaction(() => {
    const db = getSchemaReadyMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    const candidates = db.getAllSync<BackfillRow>(
      `SELECT id, predicate, object_text, source_summary
         FROM memory_facts
        WHERE ${currentFactWhereSql()}
          AND NOT (${CURRENT_VECTOR_SQL})
        ORDER BY created_at ASC, id ASC
        LIMIT ${limit + 1}`,
      memoryOwnerId,
      now,
      LOCAL_SIMILARITY_MODEL,
      LOCAL_SIMILARITY_DIMENSIONS,
      LOCAL_SIMILARITY_DIMENSIONS,
    );
    const rows = candidates.slice(0, limit);
    let processedCount = 0;
    for (const row of rows) {
      const vector = createCurrentLocalSimilarityVector(
        buildFactLocalSimilarityText({
          predicate: row.predicate,
          objectText: row.object_text,
          sourceSummary: row.source_summary,
        }),
      );
      const result = db.runSync(
        `UPDATE memory_facts
            SET local_similarity_model = ?,
                local_similarity_dimensions = ?,
                local_similarity_vector = ?,
                local_similarity_updated_at = ?
          WHERE id = ?
            AND ${currentFactWhereSql()}`,
        vector.model,
        vector.dimensions,
        JSON.stringify(vector.values),
        now,
        row.id,
        memoryOwnerId,
        now,
      );
      processedCount += result.changes ?? 0;
    }
    if (processedCount > 0) {
      runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged());
    }
    const result: LocalSimilarityBackfillResult = {
      processedCount,
      hasMore: candidates.length > limit,
      model: LOCAL_SIMILARITY_MODEL,
      dimensions: LOCAL_SIMILARITY_DIMENSIONS,
    };
    return result;
  });
}

export function maintainCurrentFactLocalSimilarity(
  input: {
    limit?: number;
    now?: number;
  } = {},
): LocalSimilarityBackfillResult | null {
  try {
    return backfillCurrentFactLocalSimilarity(input);
  } catch (error) {
    logger.devWarn(
      'Local-similarity backfill failed; lexical retrieval remains available.',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
