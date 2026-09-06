// ---------------------------------------------------------------------------
// Kavi — Provider embedding episode backfill (off the hot path)
// ---------------------------------------------------------------------------
// Episode counterpart to `providerEmbeddingBackfill.ts`: embeds NEW episodes
// through the currently-resolved provider embedding lane, maintenance-only
// and rate-limited, never from a retrieval call. The `memory_episodes.embedding`
// column (previously unused) stores the serialized vector, tagged by the
// `embedding_model`/`embedding_dimensions` columns so stale vectors from a
// since-changed provider are never treated as current.
// ---------------------------------------------------------------------------

import { createLogger } from '../../utils/logger';
import { getSchemaReadyMemoryDb, type MemoryDatabase } from './access/schemaGuard';
import { runAfterMemoryTransactionCommit, runMemoryTransaction } from './access/transaction';
import { requireFactMutationTimestamp } from './facts/mutationValidation';
import { advanceMemoryProjectionInTransaction } from './memoryAuthority';
import { notifyStructuredMemoryChanged } from './changeNotifications';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { resolveEmbeddingProviderPath } from './embeddingProviderSelection';
import { getEmbedding } from './embeddings';
import { throttledProviderEmbeddingCall } from './providerEmbeddingRateLimiter';
import { safeParseArray } from './schemaValues';
import {
  isProviderEmbeddingVector,
  serializeProviderEmbeddingVector,
  type ProviderEmbeddingVector,
} from './providerSimilarity';

const logger = createLogger('memory.providerEpisodeEmbeddingBackfill');
const DEFAULT_PROVIDER_EPISODE_EMBEDDING_BACKFILL_LIMIT = 8;
const MAXIMUM_PROVIDER_EPISODE_EMBEDDING_BACKFILL_LIMIT = 24;

type EpisodeBackfillRow = {
  id: string;
  summary: string;
  entities_json: string;
};

export interface ProviderEpisodeEmbeddingBackfillResult {
  attempted: number;
  processedCount: number;
  failedCount: number;
  hasMore: boolean;
  model: string | null;
  dimensions: number | null;
}

function normalizeBackfillLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PROVIDER_EPISODE_EMBEDDING_BACKFILL_LIMIT;
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('memory_provider_episode_embedding_backfill_limit_invalid');
  }
  return Math.min(Math.floor(value), MAXIMUM_PROVIDER_EPISODE_EMBEDDING_BACKFILL_LIMIT);
}

function buildEpisodeEmbeddingText(row: EpisodeBackfillRow): string {
  const entities = safeParseArray<string>(row.entities_json);
  return [row.summary, entities.join(' ')]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n');
}

function selectCandidateRows(
  db: MemoryDatabase,
  now: number,
  model: string,
  dimensions: number,
  limit: number,
): EpisodeBackfillRow[] {
  return db.getAllSync<EpisodeBackfillRow>(
    `SELECT id, summary, entities_json
       FROM memory_episodes
      WHERE deleted_at IS NULL
        AND ended_at <= ?
        AND NOT (
          embedding_model IS ?
          AND embedding_dimensions IS ?
          AND embedding IS NOT NULL
        )
      ORDER BY ended_at DESC, id ASC
      LIMIT ${limit + 1}`,
    now,
    model,
    dimensions,
  );
}

function persistEpisodeEmbedding(
  db: MemoryDatabase,
  now: number,
  episodeId: string,
  vector: ProviderEmbeddingVector,
  serializedVector: string,
): boolean {
  const result = runMemoryTransaction(() =>
    db.runSync(
      `UPDATE memory_episodes
          SET embedding = ?,
              embedding_model = ?,
              embedding_dimensions = ?,
              embedding_updated_at = ?
        WHERE id = ?
          AND deleted_at IS NULL`,
      serializedVector,
      vector.model,
      vector.dimensions,
      now,
      episodeId,
    ),
  );
  return (result.changes ?? 0) > 0;
}

/**
 * Embed up to `limit` episodes lacking a provider vector for the
 * presently-resolved embedding provider. Never throws.
 */
export async function maintainProviderEpisodeEmbeddings(
  input: { limit?: number; now?: number } = {},
): Promise<ProviderEpisodeEmbeddingBackfillResult | null> {
  try {
    const limit = normalizeBackfillLimit(input.limit);
    const now = requireFactMutationTimestamp(
      input.now ?? Date.now(),
      'memory_provider_episode_embedding_clock_invalid',
    );
    const path = await resolveEmbeddingProviderPath();
    if (!path) return null;
    const model = path.config.model ?? '';
    const dimensions = path.config.dimensions ?? 0;
    if (!model || !dimensions) return null;

    const db = getSchemaReadyMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    const candidates = selectCandidateRows(db, now, model, dimensions, limit);
    const rows = candidates.slice(0, limit);
    let processedCount = 0;
    let failedCount = 0;
    for (const row of rows) {
      const text = buildEpisodeEmbeddingText(row);
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
        if (persistEpisodeEmbedding(db, now, row.id, vector, serialized)) {
          processedCount += 1;
        }
      } catch (error) {
        failedCount += 1;
        logger.devWarn(
          `Provider embedding failed for episode ${row.id}; will retry on the next maintenance pass.`,
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
      'Provider embedding episode backfill failed; lexical episode retrieval remains available.',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
