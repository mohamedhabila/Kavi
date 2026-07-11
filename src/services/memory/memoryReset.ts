import { ensureDefaultBlocks } from './blocks';
import { notifyStructuredMemoryChanged } from './changeNotifications';
import { clearEmbeddingCache, getEmbeddingCacheEntryCount } from './embeddings';
import { clearStructuredMemory } from './schema';

export function resetCanonicalMemoryForManagement(now = Date.now()): void {
  clearStructuredMemory();
  clearEmbeddingCache();
  if (getEmbeddingCacheEntryCount() !== 0) {
    throw new Error('memory_reset_embedding_cache_residual');
  }
  ensureDefaultBlocks(now);
  notifyStructuredMemoryChanged();
}
