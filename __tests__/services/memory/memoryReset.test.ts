const mockClearStructuredMemory = jest.fn();
const mockClearEmbeddingCache = jest.fn();
const mockGetEmbeddingCacheEntryCount = jest.fn();
const mockEnsureDefaultBlocks = jest.fn();
const mockNotifyStructuredMemoryChanged = jest.fn();

jest.mock('../../../src/services/memory/schema', () => ({
  clearStructuredMemory: () => mockClearStructuredMemory(),
}));

jest.mock('../../../src/services/memory/embeddings', () => ({
  clearEmbeddingCache: () => mockClearEmbeddingCache(),
  getEmbeddingCacheEntryCount: () => mockGetEmbeddingCacheEntryCount(),
}));

jest.mock('../../../src/services/memory/blocks', () => ({
  ensureDefaultBlocks: (now: number) => mockEnsureDefaultBlocks(now),
}));

jest.mock('../../../src/services/memory/changeNotifications', () => ({
  notifyStructuredMemoryChanged: () => mockNotifyStructuredMemoryChanged(),
}));

import { resetCanonicalMemoryForManagement } from '../../../src/services/memory/memoryReset';

describe('canonical memory reset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEmbeddingCacheEntryCount.mockReturnValue(0);
  });

  it('clears canonical state, restores blocks, and publishes the change', () => {
    resetCanonicalMemoryForManagement(1_234);

    expect(mockClearStructuredMemory).toHaveBeenCalledTimes(1);
    expect(mockClearEmbeddingCache).toHaveBeenCalledTimes(1);
    expect(mockEnsureDefaultBlocks).toHaveBeenCalledWith(1_234);
    expect(mockNotifyStructuredMemoryChanged).toHaveBeenCalledTimes(1);
  });

  it('fails closed when embedding cache cleanup leaves residual state', () => {
    mockGetEmbeddingCacheEntryCount.mockReturnValue(1);

    expect(() => resetCanonicalMemoryForManagement()).toThrow(
      'memory_reset_embedding_cache_residual',
    );
    expect(mockEnsureDefaultBlocks).not.toHaveBeenCalled();
    expect(mockNotifyStructuredMemoryChanged).not.toHaveBeenCalled();
  });
});
