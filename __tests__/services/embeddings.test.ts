// ---------------------------------------------------------------------------
// Embeddings Service — tests
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// Mock SecureStorage (used for API key fallback)
jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: jest.fn().mockResolvedValue(null),
  setSecure: jest.fn().mockResolvedValue(undefined),
  deleteSecure: jest.fn().mockResolvedValue(undefined),
}));

import {
  getEmbedding,
  getEmbeddingCached,
  clearEmbeddingCache,
  CACHE_CONFIG,
  DEFAULT_LOCAL_EMBEDDING_CONFIG,
  isLocalEmbeddingConfig,
} from '../../src/services/memory/embeddings';
import { createCharacterNgramVector } from '../../src/services/memory/localSimilarity';

describe('Embeddings Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearEmbeddingCache();
  });

  describe('getEmbedding', () => {
    it('returns deterministic local Unicode n-gram embeddings without network calls', async () => {
      const first = await getEmbedding('東京の会議場所', {
        ...DEFAULT_LOCAL_EMBEDDING_CONFIG,
        dimensions: 128,
      });
      const second = await getEmbedding('東京の会議場所', {
        ...DEFAULT_LOCAL_EMBEDDING_CONFIG,
        dimensions: 128,
      });

      expect(first.model).toBe(DEFAULT_LOCAL_EMBEDDING_CONFIG.model);
      expect(first.embedding).toHaveLength(128);
      expect(first.embedding).toEqual(second.embedding);
      expect(first.embedding.some((value) => value !== 0)).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(isLocalEmbeddingConfig(DEFAULT_LOCAL_EMBEDDING_CONFIG)).toBe(true);
    });

    it('keeps local embeddings language-agnostic at the feature level', () => {
      const arabic = createCharacterNgramVector('القهوة السادة', 96);
      const japanese = createCharacterNgramVector('東京の会議場所', 96);

      expect(arabic).toHaveLength(96);
      expect(japanese).toHaveLength(96);
      expect(arabic.some((value) => value !== 0)).toBe(true);
      expect(japanese.some((value) => value !== 0)).toBe(true);
    });

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
});
