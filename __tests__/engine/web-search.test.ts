// ---------------------------------------------------------------------------
// Tests — Web Search Tool
// ---------------------------------------------------------------------------

import { clearWebSearchCaches, executeWebSearch } from '../../src/engine/tools/web-search';

// Mock SecureStorage
const mockGetSecure = jest.fn();
jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
}));

const mockFetch = jest.fn();
const originalFetch = global.fetch;
let queryCounter = 0;
function uniqueQuery(prefix: string) {
  return `${prefix}-${++queryCounter}-${Date.now()}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch;
  mockGetSecure.mockResolvedValue(null);
  clearWebSearchCaches();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('executeWebSearch', () => {
  it('returns error when query is empty', async () => {
    const result = await executeWebSearch({ query: '' });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('Search query is required');
  });

  it('returns error when no provider is configured', async () => {
    mockGetSecure.mockResolvedValue(null);
    const result = await executeWebSearch({ query: 'test query' });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('No search provider configured');
  });

  // ── Brave Search ─────────────────────────────────────────────────────

  describe('brave provider', () => {
    beforeEach(() => {
      mockGetSecure.mockImplementation((key: string) =>
        key === 'BRAVE_API_KEY' ? Promise.resolve('brave-key-123') : Promise.resolve(null),
      );
    });

    it('searches with auto-detected brave provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            web: {
              results: [
                { title: 'Result 1', url: 'https://r1.com', description: 'Desc 1', age: '2h' },
                { title: 'Result 2', url: 'https://r2.com', description: 'Desc 2' },
              ],
            },
          }),
      });

      const result = await executeWebSearch({ query: 'test search' });
      const parsed = JSON.parse(result);
      expect(parsed.provider).toBe('brave');
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results[0].title).toBe('Result 1');
      expect(parsed.citations).toContain('https://r1.com');
      expect(mockFetch.mock.calls[0][1].credentials).toBe('omit');
    });

    it('passes freshness and country parameters to brave', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ web: { results: [] } }),
      });

      await executeWebSearch({
        query: 'recent news',
        freshness: 'day',
        country: 'US',
        language: 'en',
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('freshness=pd');
      expect(calledUrl).toContain('country=US');
      expect(calledUrl).toContain('search_lang=en');
    });

    it('handles freshness aliases (pw, pm, py)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ web: { results: [] } }),
      });

      await executeWebSearch({ query: uniqueQuery('brave-fresh'), freshness: 'week' });
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('freshness=pw');
    });

    it('handles brave API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
      });

      const result = await executeWebSearch({ query: 'rate limited' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Search failed');
    });

    it('respects forced provider parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ web: { results: [] } }),
      });

      const result = await executeWebSearch({
        query: uniqueQuery('brave-force'),
        provider: 'brave',
      });
      const parsed = JSON.parse(result);
      expect(parsed.provider).toBe('brave');
    });
  });

  // ── Perplexity Search ────────────────────────────────────────────────

  describe('perplexity provider', () => {
    beforeEach(() => {
      mockGetSecure.mockImplementation((key: string) =>
        key === 'PERPLEXITY_API_KEY' ? Promise.resolve('pplx-key-123') : Promise.resolve(null),
      );
    });

    it('searches with perplexity using direct API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: 'AI summary of results',
                  annotations: [{ url_citation: { url: 'https://cite1.com' } }],
                },
              },
            ],
            citations: ['https://cite2.com'],
          }),
      });

      const q = uniqueQuery('pplx-search');
      const result = await executeWebSearch({ query: q, provider: 'perplexity' });
      const parsed = JSON.parse(result);
      expect(parsed.provider).toBe('perplexity');
      expect(parsed.summary).toBe('AI summary of results');
      expect(parsed.citations).toContain('https://cite1.com');
      expect(parsed.citations).toContain('https://cite2.com');
      expect(mockFetch.mock.calls[0][1].credentials).toBe('omit');
    });

    it('uses direct perplexity URL for pplx- prefix keys', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'result' } }],
          }),
      });

      await executeWebSearch({ query: uniqueQuery('pplx-url'), provider: 'perplexity' });
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('api.perplexity.ai');
    });

    it('uses openrouter URL for non-pplx keys', async () => {
      mockGetSecure.mockImplementation((key: string) =>
        key === 'PERPLEXITY_API_KEY' ? Promise.resolve('sk-or-key') : Promise.resolve(null),
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'result' } }],
          }),
      });

      await executeWebSearch({ query: uniqueQuery('or-url'), provider: 'perplexity' });
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('openrouter.ai');
    });

    it('passes freshness as recency filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'result' } }],
          }),
      });

      await executeWebSearch({
        query: uniqueQuery('pplx-fresh'),
        provider: 'perplexity',
        freshness: 'pw',
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.search_recency_filter).toBe('week');
    });

    it('handles perplexity error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      const result = await executeWebSearch({
        query: uniqueQuery('pplx-err'),
        provider: 'perplexity',
      });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Search failed');
    });
  });

  // ── Grok Search ──────────────────────────────────────────────────────

  describe('grok provider', () => {
    beforeEach(() => {
      mockGetSecure.mockImplementation((key: string) =>
        key === 'XAI_API_KEY' ? Promise.resolve('xai-key') : Promise.resolve(null),
      );
    });

    it('searches with grok using xAI Responses API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'Grok summary',
                    annotations: [{ type: 'url_citation', url: 'https://grok-cite.com' }],
                  },
                ],
              },
            ],
          }),
      });

      const result = await executeWebSearch({ query: uniqueQuery('grok-main'), provider: 'grok' });
      const parsed = JSON.parse(result);
      expect(parsed.provider).toBe('grok');
      expect(parsed.summary).toBe('Grok summary');
      expect(parsed.citations).toContain('https://grok-cite.com');
    });

    it('handles grok output_text format at top level', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            output: [
              {
                type: 'output_text',
                text: 'Top level text',
                annotations: [{ type: 'url_citation', url: 'https://top-cite.com' }],
              },
            ],
          }),
      });

      const result = await executeWebSearch({ query: uniqueQuery('grok-top'), provider: 'grok' });
      const parsed = JSON.parse(result);
      expect(parsed.summary).toBe('Top level text');
    });

    it('handles grok output_text as string', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            output: [],
            output_text: 'Fallback text',
            citations: ['https://fallback.com'],
          }),
      });

      const result = await executeWebSearch({
        query: uniqueQuery('grok-fallback'),
        provider: 'grok',
      });
      const parsed = JSON.parse(result);
      expect(parsed.summary).toBe('Fallback text');
      expect(parsed.citations).toContain('https://fallback.com');
    });
  });

  // ── Kimi Search ──────────────────────────────────────────────────────

  describe('kimi provider', () => {
    beforeEach(() => {
      mockGetSecure.mockImplementation((key: string) =>
        key === 'KIMI_API_KEY' ? Promise.resolve('kimi-key') : Promise.resolve(null),
      );
    });

    it('searches with kimi (moonshot)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'Kimi result' } }],
            search_results: [{ title: 'Kimi link', url: 'https://kimi.com', content: 'Kimi desc' }],
          }),
      });

      const result = await executeWebSearch({ query: uniqueQuery('kimi-main'), provider: 'kimi' });
      const parsed = JSON.parse(result);
      expect(parsed.provider).toBe('kimi');
      expect(parsed.summary).toBe('Kimi result');
      expect(parsed.results[0].title).toBe('Kimi link');
    });

    it('handles kimi API error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      const result = await executeWebSearch({ query: uniqueQuery('kimi-err'), provider: 'kimi' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Search failed');
    });
  });

  // ── Gemini Search ────────────────────────────────────────────────────

  describe('gemini provider', () => {
    beforeEach(() => {
      mockGetSecure.mockImplementation((key: string) =>
        key === 'GOOGLE_API_KEY' ? Promise.resolve('google-key') : Promise.resolve(null),
      );
    });

    it('searches with Vertex Gemini first when using a Google API key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Gemini answer' }],
                },
                groundingMetadata: {
                  groundingChunks: [{ web: { uri: 'https://gemini-cite.com' } }],
                  webSearchQueries: ['test'],
                },
              },
            ],
          }),
      });

      const result = await executeWebSearch({
        query: uniqueQuery('gemini-main'),
        provider: 'gemini',
      });
      const parsed = JSON.parse(result);
      expect(parsed.provider).toBe('gemini');
      expect(parsed.backend).toBe('vertex');
      expect(parsed.summary).toBe('Gemini answer');
      expect(parsed.citations).toContain('https://gemini-cite.com');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-goog-api-key': 'google-key',
          }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('publishers/google/models/gemini-2.5-flash');
      expect(body.tools).toEqual([{ googleSearch: {} }]);
    });

    it('handles gemini with no grounding metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [{ text: 'No grounding' }],
                },
              },
            ],
          }),
      });

      const result = await executeWebSearch({
        query: uniqueQuery('gemini-noground'),
        provider: 'gemini',
      });
      const parsed = JSON.parse(result);
      expect(parsed.summary).toBe('No grounding');
      expect(parsed.citations).toEqual([]);
    });

    it('falls back to AI Studio when Vertex rejects the key and caches the working backend', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: () => Promise.resolve('PERMISSION_DENIED'),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              candidates: [
                {
                  content: { parts: [{ text: 'AI Studio fallback answer' }] },
                  groundingMetadata: {
                    groundingChunks: [{ web: { uri: 'https://fallback.example.com' } }],
                  },
                },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              candidates: [
                {
                  content: { parts: [{ text: 'Cached fallback answer' }] },
                },
              ],
            }),
        });

      const first = JSON.parse(
        await executeWebSearch({ query: uniqueQuery('gemini-fallback-1'), provider: 'gemini' }),
      );
      const second = JSON.parse(
        await executeWebSearch({ query: uniqueQuery('gemini-fallback-2'), provider: 'gemini' }),
      );

      expect(first.backend).toBe('ai-studio');
      expect(first.summary).toBe('AI Studio fallback answer');
      expect(first.citations).toContain('https://fallback.example.com');
      expect(second.backend).toBe('ai-studio');

      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent',
      );
      expect(mockFetch.mock.calls[1][0]).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      );
      expect(mockFetch.mock.calls[2][0]).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      );

      const fallbackBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(fallbackBody.model).toBeUndefined();
      expect(fallbackBody.tools).toEqual([{ google_search: {} }]);
    });
  });

  // ── Caching ──────────────────────────────────────────────────────────

  describe('caching', () => {
    it('returns cached results on repeat query', async () => {
      mockGetSecure.mockImplementation((key: string) =>
        key === 'BRAVE_API_KEY' ? Promise.resolve('brave-key') : Promise.resolve(null),
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            web: { results: [{ title: 'Cached', url: 'https://cached.com', description: 'test' }] },
          }),
      });

      const q = uniqueQuery('cache-test');
      // First call
      await executeWebSearch({ query: q });
      // Second call — should use cache
      const result = await executeWebSearch({ query: q });
      const parsed = JSON.parse(result);
      expect(parsed.results[0].title).toBe('Cached');
      // Only one actual fetch call
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ── Auto-detection ───────────────────────────────────────────────────

  describe('provider auto-detection', () => {
    it('selects first available provider (perplexity when no brave)', async () => {
      mockGetSecure.mockImplementation((key: string) => {
        if (key === 'PERPLEXITY_API_KEY') return Promise.resolve('pplx-auto');
        return Promise.resolve(null);
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'auto result' } }],
          }),
      });

      const result = await executeWebSearch({ query: 'auto detect test' });
      const parsed = JSON.parse(result);
      expect(parsed.provider).toBe('perplexity');
    });
  });

  // ── Count parameter ──────────────────────────────────────────────────

  describe('count parameter', () => {
    it('clamps count to valid range', async () => {
      mockGetSecure.mockImplementation((key: string) =>
        key === 'BRAVE_API_KEY' ? Promise.resolve('brave-key') : Promise.resolve(null),
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ web: { results: [] } }),
      });

      await executeWebSearch({ query: 'count test', count: 20 });
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('count=10');
    });
  });
});
