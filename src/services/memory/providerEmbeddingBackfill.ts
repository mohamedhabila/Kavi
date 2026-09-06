// ---------------------------------------------------------------------------
// Kavi — Provider embedding fact backfill (off the hot path)
// ---------------------------------------------------------------------------
// Embeds NEW facts through the currently-resolved provider embedding lane.
// This is maintenance work only: it is driven from the consolidation
// scheduler after a turn closes, never from a retrieval call. Batched and
// rate-limited (see `providerEmbeddingRateLimiter`); any provider failure
// for one fact is isolated and does not fail the batch. When no provider is
// configured/enabled this is a fast, network-free no-op — the on-device
// local-similarity lane remains the fallback either way.
// ---------------------------------------------------------------------------

import { createLogger } from '../../utils/logger';
import { getSchemaReadyMemoryDb, type MemoryDatabase } from './access/schemaGuard';
import { runAfterMemoryTransactionCommit, runMemoryTransaction } from './access/transaction';
import { requireFactMutationTimestamp } from './facts/mutationValidation';
import { buildFactLocalSimilarityText } from './localSimilarity';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { notifyStructuredMemoryChanged } from './changeNotifications';
import { advanceMemoryProjectionInTransaction } from './memoryAuthority';
import { resolveEmbeddingProviderPath } from './embeddingProviderSelection';
import { getEmbedding } from './embeddings';
import { throttledProviderEmbeddingCall } from './providerEmbeddingRateLimiter';
import {
  isProviderEmbeddingVector,
  serializeProviderEmbeddingVector,
  type ProviderEmbeddingVector,
} from './providerSimilarity';

const logger = createLogger('memory.providerEmbeddingBackfill');
const DEFAULT_PROVIDER_EMBEDDING_BACKFILL_LIMIT = 8;
const MAXIMUM_PROVIDER_EMBEDDING_BACKFILL_LIMIT = 24;

type BackfillRow = {
  id: string;
  predicate: string;
  object_text: string;
  source_summary: string | null;
};

export interface ProviderEmbeddingBackfillResult {
  attempted: number;
  processedCount: number;
  failedCount: number;
  hasMore: boolean;
  model: string | null;
  dimensions: number | null;
}

function normalizeBackfillLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PROVIDER_EMBEDDING_BACKFILL_LIMIT;
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('memory_provider_embedding_backfill_limit_invalid');
  }
  return Math.min(Math.floor(value), MAXIMUM_PROVIDER_EMBEDDING_BACKFILL_LIMIT);
}

function currentFactWhereSql(): string {
  return `memory_owner_id = ?
    AND invalid_at IS NULL
    AND deleted_at IS NULL
    AND (expires_at IS NULL OR expires_at > ?)`;
}

function selectCandidateRows(
  db: MemoryDatabase,
  memoryOwnerId: string,
  now: number,
  model: string,
  dimensions: number,
  limit: number,
): BackfillRow[] {
  return db.getAllSync<BackfillRow>(
    `SELECT id, predicate, object_text, source_summary
       FROM memory_facts
      WHERE ${currentFactWhereSql()}
        AND NOT (
          provider_embedding_model IS ?
          AND provider_embedding_dimensions IS ?
          AND provider_embedding_vector IS NOT NULL
        )
      ORDER BY updated_at DESC, id ASC
      LIMIT ${limit + 1}`,
    memoryOwnerId,
    now,
    model,
    dimensions,
  );
}

function persistFactEmbedding(
  db: MemoryDatabase,
  memoryOwnerId: string,
  now: number,
  factId: string,
  vector: ProviderEmbeddingVector,
  serializedVector: string,
): boolean {
  const result = runMemoryTransaction(() =>
    db.runSync(
      `UPDATE memory_facts
          SET provider_embedding_model = ?,
              provider_embedding_dimensions = ?,
              provider_embedding_vector = ?,
              provider_embedding_updated_at = ?
        WHERE id = ?
          AND ${currentFactWhereSql()}`,
      vector.model,
      vector.dimensions,
      serializedVector,
      now,
      factId,
      memoryOwnerId,
      now,
    ),
  );
  return (result.changes ?? 0) > 0;
}

/**
 * Embed up to `limit` currently-valid facts lacking a provider vector for the
 * presently-resolved embedding provider. Never throws — provider outages,
 * gating, or storage errors degrade to a no-op result so callers (the
 * consolidation scheduler) can safely fire-and-forget this.
 */
export async function maintainProviderFactEmbeddings(
  input: { limit?: number; now?: number } = {},
): Promise<ProviderEmbeddingBackfillResult | null> {
  try {
    const limit = normalizeBackfillLimit(input.limit);
    const now = requireFactMutationTimestamp(
      input.now ?? Date.now(),
      'memory_provider_embedding_clock_invalid',
    );
    const path = await resolveEmbeddingProviderPath();
    if (!path) return null;
    const model = path.config.model ?? '';
    const dimensions = path.config.dimensions ?? 0;
    if (!model || !dimensions) return null;

    const db = getSchemaReadyMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    const candidates = selectCandidateRows(db, memoryOwnerId, now, model, dimensions, limit);
    const rows = candidates.slice(0, limit);
    let processedCount = 0;
    let failedCount = 0;
    for (const row of rows) {
      const text = buildFactLocalSimilarityText({
        predicate: row.predicate,
        objectText: row.object_text,
        sourceSummary: row.source_summary,
      });
      if (!text.trim()) continue;
      try {
        const result = await throttledProviderEmbeddingCall(() =>
          getEmbedding(text, path.config),
        );
        const vector: ProviderEmbeddingVector = {
          model: result.model || model,
          dimensions: result.embedding.length,
          values: result.embedding,
        };
        if (!isProviderEmbeddingVector(vector)) {
          failedCount += 1;
          continue;
        }
        const serialized = serializeProviderEmbeddingVector(vector);
        if (persistFactEmbedding(db, memoryOwnerId, now, row.id, vector, serialized)) {
          processedCount += 1;
        }
      } catch (error) {
        failedCount += 1;
        logger.devWarn(
          `Provider embedding failed for fact ${row.id}; will retry on the next maintenance pass.`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    if (processedCount > 0) {
      runMemoryTransaction(() => {
        advanceMemoryProjectionInTransaction(db, memoryOwnerId);
        runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged());
      });
    }
    return {
      attempted: rows.length,
      processedCount,
      failedCount,
      hasMore: candidates.length > limit,
      model,
      dimensions,
    };
  } catch (error) {
    logger.devWarn(
      'Provider embedding fact backfill failed; local-similarity retrieval remains available.',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
