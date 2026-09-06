// ---------------------------------------------------------------------------
// Kavi — Per-turn provider query embedding
// ---------------------------------------------------------------------------
// Embeds the current turn's retrieval query through a provider (when one is
// configured and enabled) exactly once per call, backed by the shared
// bounded in-memory embedding cache in `embeddings.ts` (TTL + max-size), and
// bounded by a hard wall-clock timeout. On any failure, mismatch, or timeout
// this resolves to `null` so retrieval proceeds on the on-device fallback
// lane — it never throws, and it is never called from inside a retrieval
// scoring path (only from the memory-access gateway, once per turn).
// ---------------------------------------------------------------------------

import { createLogger } from '../../utils/logger';
import { resolveEmbeddingProviderPath } from './embeddingProviderSelection';
import { getEmbeddingCached } from './embeddings';
import { isProviderEmbeddingVector, type ProviderEmbeddingVector } from './providerSimilarity';

const logger = createLogger('memory.providerQueryEmbedding');

/** Hard budget for the provider query embedding. Retrieval never waits past this. */
export const QUERY_PROVIDER_EMBEDDING_TIMEOUT_MS = 1_500;

class ProviderQueryEmbeddingTimeoutError extends Error {
  constructor() {
    super('provider_query_embedding_timeout');
    this.name = 'ProviderQueryEmbeddingTimeoutError';
  }
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProviderQueryEmbeddingTimeoutError()), ms);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Resolve a compatible provider query vector for `text`, or `null` when no
 * provider is configured/enabled, the call fails, or it does not complete
 * within `QUERY_PROVIDER_EMBEDDING_TIMEOUT_MS`. Never throws.
 */
export async function getQueryProviderEmbeddingVector(
  text: string,
): Promise<ProviderEmbeddingVector | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const path = await resolveEmbeddingProviderPath();
    if (!path) return null;
    const outcome = await raceWithTimeout(
      getEmbeddingCached(trimmed, path.config),
      QUERY_PROVIDER_EMBEDDING_TIMEOUT_MS,
    );
    const vector: ProviderEmbeddingVector = {
      model: path.config.model ?? '',
      dimensions: outcome.length,
      values: outcome,
    };
    return isProviderEmbeddingVector(vector) ? vector : null;
  } catch (error) {
    const reason =
      error instanceof ProviderQueryEmbeddingTimeoutError
        ? 'timed out'
        : (error instanceof Error ? error.message : String(error));
    logger.devWarn(`Provider query embedding unavailable (${reason}); continuing on the local lane.`);
    return null;
  }
}
