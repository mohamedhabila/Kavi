import { notifyStructuredMemoryChanged } from './changeNotifications';
import { clearEmbeddingCache, getEmbeddingCacheEntryCount } from './embeddings';
import { clearStructuredMemory } from './schema';

export function resetCanonicalMemoryForManagement(): void {
  clearStructuredMemory();
  clearEmbeddingCache();
  if (getEmbeddingCacheEntryCount() !== 0) {
    throw new Error('memory_reset_embedding_cache_residual');
  }
  notifyStructuredMemoryChanged();
}
