const mockClearStructuredMemory = jest.fn();
const mockClearEmbeddingCache = jest.fn();
const mockGetEmbeddingCacheEntryCount = jest.fn();
const mockNotifyStructuredMemoryChanged = jest.fn();

jest.mock('../../../src/services/memory/schema', () => ({
  clearStructuredMemory: () => mockClearStructuredMemory(),
}));

jest.mock('../../../src/services/memory/embeddings', () => ({
  clearEmbeddingCache: () => mockClearEmbeddingCache(),
  getEmbeddingCacheEntryCount: () => mockGetEmbeddingCacheEntryCount(),
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

  it('clears canonical state and publishes the change', () => {
    resetCanonicalMemoryForManagement();

    expect(mockClearStructuredMemory).toHaveBeenCalledTimes(1);
    expect(mockClearEmbeddingCache).toHaveBeenCalledTimes(1);
    expect(mockNotifyStructuredMemoryChanged).toHaveBeenCalledTimes(1);
  });

  it('fails closed when embedding cache cleanup leaves residual state', () => {
    mockGetEmbeddingCacheEntryCount.mockReturnValue(1);

    expect(() => resetCanonicalMemoryForManagement()).toThrow(
      'memory_reset_embedding_cache_residual',
    );
    expect(mockNotifyStructuredMemoryChanged).not.toHaveBeenCalled();
  });
});
