// ---------------------------------------------------------------------------
// Embeddings Service — tests
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// Mock memory store (used by indexMemory / hybridSearch internally)
jest.mock('../../src/services/memory/store', () => ({
  readConversationMemory: jest.fn().mockReturnValue(null),
  readGlobalMemory: jest.fn().mockReturnValue(null),
  listDailyMemoryFiles: jest.fn().mockReturnValue([]),
  readDailyMemory: jest.fn().mockReturnValue(null),
  searchMemory: jest.fn().mockReturnValue([]),
}));

// Mock SecureStorage (used for API key fallback)
jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: jest.fn().mockResolvedValue(null),
  setSecure: jest.fn().mockResolvedValue(undefined),
  deleteSecure: jest.fn().mockResolvedValue(undefined),
}));

import {
  cosineSimilarity,
  temporalDecay,
  getEmbedding,
  getEmbeddingCached,
  indexMemory,
  hybridSearch,
  clearEmbeddingCache,
  getIndexSize,
  CACHE_CONFIG,
} from '../../src/services/memory/embeddings';

const {
  readConversationMemory,
  readGlobalMemory,
  listDailyMemoryFiles,
  readDailyMemory,
  searchMemory,
} = require('../../src/services/memory/store');

describe('Embeddings Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearEmbeddingCache();
    readConversationMemory.mockReturnValue(null);
    readGlobalMemory.mockReturnValue(null);
    listDailyMemoryFiles.mockReturnValue([]);
    readDailyMemory.mockReturnValue(null);
    searchMemory.mockReturnValue([]);
  });

  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const v = [1, 0, 0];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1);
    });

    it('returns 0 for orthogonal vectors', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    });

    it('returns -1 for opposite vectors', () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
    });

    it('handles zero vectors gracefully', () => {
      expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
    });

    it('works with arbitrary vectors', () => {
      const result = cosineSimilarity([1, 2, 3], [4, 5, 6]);
      expect(result).toBeGreaterThan(0.9);
    });
  });

  describe('temporalDecay', () => {
    it('returns 1.0 for current timestamp', () => {
      expect(temporalDecay(Date.now())).toBeCloseTo(1.0, 1);
    });

    it('returns < 1.0 for old timestamps', () => {
      const oneDay = Date.now() - 86400000;
      expect(temporalDecay(oneDay)).toBeLessThan(1.0);
    });

    it('returns > 0 for very old timestamps', () => {
      const oldTs = Date.now() - 365 * 86400000;
      expect(temporalDecay(oldTs)).toBeGreaterThan(0);
    });
  });

  describe('getEmbedding', () => {
    it('fetches OpenAI embedding and returns EmbeddingResult', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          model: 'text-embedding-3-small',
          usage: { total_tokens: 5 },
        }),
      });

      const result = await getEmbedding('test text', {
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'text-embedding-3-small',
      });
      expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(result.model).toBeDefined();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('openai.com'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('fetches Gemini embedding', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embedding: { values: [0.4, 0.5, 0.6] },
        }),
      });

      const result = await getEmbedding('test', {
        provider: 'gemini',
        apiKey: 'gemini-key',
      });
      expect(result.embedding).toEqual([0.4, 0.5, 0.6]);
    });

    it('fetches Vertex Gemini embeddings from the project/location publisher-model endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          predictions: [
            {
              embeddings: {
                values: [0.11, 0.22, 0.33],
                statistics: { token_count: 4 },
              },
            },
          ],
        }),
      });

      const result = await getEmbedding('test', {
        provider: 'gemini',
        apiKey: 'vertex-key',
        baseUrl:
          'https://us-central1-aiplatform.googleapis.com/v1/projects/demo/locations/us-central1',
      });

      expect(result.embedding).toEqual([0.11, 0.22, 0.33]);
      expect(result.model).toBe('gemini-embedding-001');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://us-central1-aiplatform.googleapis.com/v1/projects/demo/locations/us-central1/publishers/google/models/gemini-embedding-001:predict',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-goog-api-key': 'vertex-key',
          }),
        }),
      );
    });

    it('rejects undocumented Vertex express-mode embedding bases', async () => {
      await expect(
        getEmbedding('test', {
          provider: 'gemini',
          apiKey: 'vertex-key',
          baseUrl: 'https://aiplatform.googleapis.com/v1',
        }),
      ).rejects.toThrow('Vertex Gemini embeddings require a project/location-scoped base URL');
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(getEmbedding('test', { provider: 'openai', apiKey: 'bad' })).rejects.toThrow();
    });

    it('throws on unknown provider', async () => {
      await expect(
        getEmbedding('test', { provider: 'unknown' as any, apiKey: 'k' }),
      ).rejects.toThrow('Unknown embedding provider');
    });

    it('fetches Voyage embedding', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.7, 0.8] }],
          model: 'voyage-3-lite',
          usage: { total_tokens: 3 },
        }),
      });
      const result = await getEmbedding('test', { provider: 'voyage', apiKey: 'vk' });
      expect(result.embedding).toEqual([0.7, 0.8]);
    });

    it('fetches Mistral embedding', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.9, 1.0] }],
          model: 'mistral-embed',
        }),
      });
      const result = await getEmbedding('test', { provider: 'mistral', apiKey: 'mk' });
      expect(result.embedding).toEqual([0.9, 1.0]);
    });

    it('fetches Ollama embedding', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embeddings: [[0.1, 0.2]],
        }),
      });
      const result = await getEmbedding('test', { provider: 'ollama' });
      expect(result.embedding).toEqual([0.1, 0.2]);
    });

    it('throws when no API key for OpenAI', async () => {
      await expect(getEmbedding('test', { provider: 'openai' })).rejects.toThrow(
        'API key required',
      );
    });

    it('throws when no API key for Gemini', async () => {
      await expect(getEmbedding('test', { provider: 'gemini' })).rejects.toThrow(
        'API key required',
      );
    });

    it('throws when no API key for Voyage', async () => {
      await expect(getEmbedding('test', { provider: 'voyage' })).rejects.toThrow(
        'API key required',
      );
    });

    it('throws when no API key for Mistral', async () => {
      await expect(getEmbedding('test', { provider: 'mistral' })).rejects.toThrow(
        'API key required',
      );
    });
  });

  describe('getEmbeddingCached', () => {
    it('caches embeddings on repeated requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [1, 2] }],
          model: 'text-embedding-3-small',
        }),
      });

      const first = await getEmbeddingCached('cached text', { provider: 'openai', apiKey: 'k' });
      const second = await getEmbeddingCached('cached text', { provider: 'openai', apiKey: 'k' });
      expect(first).toEqual([1, 2]);
      expect(second).toEqual([1, 2]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('evicts oldest entries when cache exceeds max size', async () => {
      const origMax = CACHE_CONFIG.maxSize;
      CACHE_CONFIG.maxSize = 2;

      let callCount = 0;
      mockFetch.mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          data: [{ embedding: [++callCount] }],
          model: 'text-embedding-3-small',
        }),
      }));

      await getEmbeddingCached('text-a', { provider: 'openai', apiKey: 'k' });
      await getEmbeddingCached('text-b', { provider: 'openai', apiKey: 'k' });
      // Cache is now full (2 items). Adding a third should evict the oldest.
      await getEmbeddingCached('text-c', { provider: 'openai', apiKey: 'k' });
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // text-a should have been evicted; fetching it again should make a new API call
      await getEmbeddingCached('text-a', { provider: 'openai', apiKey: 'k' });
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // text-c should still be cached
      await getEmbeddingCached('text-c', { provider: 'openai', apiKey: 'k' });
      expect(mockFetch).toHaveBeenCalledTimes(4);

      CACHE_CONFIG.maxSize = origMax;
    });
  });

  describe('indexMemory', () => {
    it('indexes global memory sections and returns count', async () => {
      readGlobalMemory.mockReturnValue('## Section A\nContent A\n## Section B\nContent B');
      listDailyMemoryFiles.mockReturnValue([]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2] }],
          model: 'text-embedding-3-small',
        }),
      });

      const count = await indexMemory({ provider: 'openai', apiKey: 'k' });
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThan(0);
    });

    it('returns 0 when no memory exists', async () => {
      readGlobalMemory.mockReturnValue(null);
      listDailyMemoryFiles.mockReturnValue([]);

      const count = await indexMemory({ provider: 'openai', apiKey: 'k' });
      expect(count).toBe(0);
    });

    it('indexes daily memory files', async () => {
      readGlobalMemory.mockReturnValue(null);
      listDailyMemoryFiles.mockReturnValue(['2024-01-15']);
      readDailyMemory.mockReturnValue('---\nEntry 1\n---\nEntry 2');

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.5, 0.6] }],
          model: 'text-embedding-3-small',
        }),
      });

      const count = await indexMemory({ provider: 'openai', apiKey: 'k' });
      expect(count).toBeGreaterThan(0);
    });

    it('handles embedding error gracefully during indexing', async () => {
      readGlobalMemory.mockReturnValue('## Section\nSome content');
      listDailyMemoryFiles.mockReturnValue([]);

      mockFetch.mockRejectedValue(new Error('Network error'));

      const count = await indexMemory({ provider: 'openai', apiKey: 'k' });
      // Should still index with no embedding
      expect(count).toBeGreaterThan(0);
    });

    it('indexes conversation memory when requested', async () => {
      readConversationMemory.mockReturnValue('## Conversation\nShared worker note');
      readGlobalMemory.mockReturnValue(null);
      listDailyMemoryFiles.mockReturnValue([]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.3, 0.4] }],
          model: 'text-embedding-3-small',
        }),
      });

      const count = await indexMemory(
        { provider: 'openai', apiKey: 'k' },
        { scope: 'conversation', conversationId: 'conv-1' },
      );

      expect(count).toBeGreaterThan(0);
    });
  });

  describe('hybridSearch', () => {
    it('falls back to text search when no indexed entries', async () => {
      searchMemory.mockReturnValue([
        { source: 'MEMORY.md', snippet: 'The dog runs fast', score: 0.8 },
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          model: 'text-embedding-3-small',
        }),
      });

      const results = await hybridSearch('dog running', {
        embedding: { provider: 'openai', apiKey: 'k' },
        maxResults: 5,
      });
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('returns results with scores', async () => {
      // First index some memory
      readGlobalMemory.mockReturnValue('## Dogs\nThe dog runs fast');
      listDailyMemoryFiles.mockReturnValue([]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          model: 'text-embedding-3-small',
        }),
      });

      await indexMemory({ provider: 'openai', apiKey: 'k' });

      const results = await hybridSearch('dog running', {
        embedding: { provider: 'openai', apiKey: 'k' },
        maxResults: 5,
      });

      for (const r of results) {
        expect(r).toHaveProperty('score');
        expect(r).toHaveProperty('source');
        expect(r).toHaveProperty('snippet');
      }
    });

    it('filters hybrid search results to conversation memory when requested', async () => {
      readConversationMemory.mockReturnValue('## Conversation\nWorker-specific deployment note');
      readGlobalMemory.mockReturnValue('## Global\nDurable preference');
      listDailyMemoryFiles.mockReturnValue([]);
      searchMemory.mockReturnValue([
        {
          source: 'conversation/MEMORY.md',
          scope: 'conversation',
          snippet: 'Worker-specific deployment note',
          score: 1,
        },
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          model: 'text-embedding-3-small',
        }),
      });

      await indexMemory(
        { provider: 'openai', apiKey: 'k' },
        { scope: 'all', conversationId: 'conv-1' },
      );

      const results = await hybridSearch(
        'deployment note',
        {
          embedding: { provider: 'openai', apiKey: 'k' },
          maxResults: 5,
        },
        {
          scope: 'conversation',
          conversationId: 'conv-1',
        },
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((result) => result.scope === 'conversation')).toBe(true);
    });
  });

  describe('getIndexSize', () => {
    it('returns current index size', () => {
      expect(typeof getIndexSize()).toBe('number');
    });
  });
});
