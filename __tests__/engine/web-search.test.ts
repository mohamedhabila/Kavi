import {
  clearWebSearchCaches,
  executeWebSearch,
  WEB_SEARCH_TOOL,
} from '../../src/engine/tools/web-search';
import { useSettingsStore } from '../../src/store/useSettingsStore';

const mockGetSecure = jest.fn();
jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
}));

const mockFetch = jest.fn();
const originalFetch = global.fetch;
let queryCounter = 0;

function uniqueQuery(prefix: string) {
  queryCounter += 1;
  return `${prefix}-${queryCounter}-${Date.now()}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReset();
  mockGetSecure.mockReset();
  global.fetch = mockFetch;
  mockGetSecure.mockResolvedValue(null);
  clearWebSearchCaches();
  useSettingsStore.setState({
    activeProviderId: null,
    activeModel: null,
    providers: [],
    webSearchProvider: 'auto',
  } as any);
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('executeWebSearch', () => {
  it('exposes a batched shallow queries contract', () => {
    const schema = WEB_SEARCH_TOOL.input_schema as Record<string, any>;

    expect(schema.properties.query).toBeUndefined();
    expect(schema.properties.queries).toMatchObject({
      type: 'array',
      minItems: 1,
      maxItems: 4,
    });
    expect(schema.properties.count).toBeUndefined();
    expect(schema.properties.sites).toBeUndefined();
    expect(schema.required).toEqual(['queries']);
    expect(WEB_SEARCH_TOOL.description).toContain('Use plain-language queries.');
    expect(WEB_SEARCH_TOOL.description).not.toContain('site:host');
    expect(WEB_SEARCH_TOOL.description).not.toContain(
      'batch complementary query variants for the same source in the same call',
    );
    expect(WEB_SEARCH_TOOL.description).toContain(
      'Pass several URLs together in one web_fetch call when multiple pages should be read.',
    );
  });

  it('returns an error when queries is missing or empty', async () => {
    const missing = JSON.parse(await executeWebSearch({}));
    expect(missing.error).toBe('At least one search query is required');

    const empty = JSON.parse(await executeWebSearch({ queries: [''] }));
    expect(empty.error).toBe('At least one search query is required');
  });

  it('fails closed when no search provider is configured', async () => {
    const parsed = JSON.parse(await executeWebSearch({ queries: ['test query'] }));
    expect(parsed.error).toBe(
      'No web search provider configured. Add an API key in Settings for Brave, Gemini, Perplexity, Grok (xAI), or Kimi.',
    );
  });

  it('returns the canonical shallow searches payload for a single query', async () => {
    mockGetSecure.mockImplementation((key: string) =>
      key === 'BRAVE_API_KEY' ? Promise.resolve('brave-key-123') : Promise.resolve(null),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: 'Result 1', url: 'https://r1.com', description: 'ignored summary' },
          ],
        },
      }),
    });

    const parsed = JSON.parse(await executeWebSearch({ queries: ['canonical single query'] }));

    expect(parsed.provider).toBe('brave');
    expect(parsed.query).toBeUndefined();
    expect(parsed.results).toBeUndefined();
    expect(parsed.searches).toEqual([
      {
        query: 'canonical single query',
        results: [{ title: 'Result 1', url: 'https://r1.com' }],
      },
    ]);
  });

  it('runs multiple independent queries in one batched call', async () => {
    mockGetSecure.mockImplementation((key: string) =>
      key === 'BRAVE_API_KEY' ? Promise.resolve('brave-key-123') : Promise.resolve(null),
    );

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          web: {
            results: [{ title: 'OpenAI Docs', url: 'https://platform.openai.com/docs' }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          web: {
            results: [{ title: 'Gemini Docs', url: 'https://ai.google.dev/docs' }],
          },
        }),
      });

    const parsed = JSON.parse(
      await executeWebSearch({
        queries: ['openai responses docs', 'gemini generatecontent docs'],
      }),
    );

    expect(parsed.provider).toBe('brave');
    expect(parsed.searches).toEqual([
      {
        query: 'openai responses docs',
        results: [{ title: 'OpenAI Docs', url: 'https://platform.openai.com/docs' }],
      },
      {
        query: 'gemini generatecontent docs',
        results: [{ title: 'Gemini Docs', url: 'https://ai.google.dev/docs' }],
      },
    ]);
  });

  it('passes freshness and locale parameters to Brave with a provider-level top-5 result budget', async () => {
    mockGetSecure.mockImplementation((key: string) =>
      key === 'BRAVE_API_KEY' ? Promise.resolve('brave-key-123') : Promise.resolve(null),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    });

    await executeWebSearch({
      queries: ['latest docs'],
      freshness: 'week',
      country: 'us',
      language: 'en',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [requestUrl] = mockFetch.mock.calls[0];
    const parsed = new URL(requestUrl as string);
    expect(parsed.searchParams.get('q')).toBe('latest docs');
    expect(parsed.searchParams.get('count')).toBe('5');
    expect(parsed.searchParams.get('freshness')).toBe('pw');
    expect(parsed.searchParams.get('country')).toBe('US');
    expect(parsed.searchParams.get('search_lang')).toBe('en');
  });

  it('returns only the top 5 provider results per query', async () => {
    mockGetSecure.mockImplementation((key: string) =>
      key === 'BRAVE_API_KEY' ? Promise.resolve('brave-key-123') : Promise.resolve(null),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: 'One', url: 'https://one.example.com' },
            { title: 'Two', url: 'https://two.example.com' },
            { title: 'Three', url: 'https://three.example.com' },
            { title: 'Four', url: 'https://four.example.com' },
            { title: 'Five', url: 'https://five.example.com' },
            { title: 'Six', url: 'https://six.example.com' },
          ],
        },
      }),
    });

    const parsed = JSON.parse(await executeWebSearch({ queries: ['top 5 only'] }));

    expect(parsed.searches).toEqual([
      {
        query: 'top 5 only',
        results: [
          { title: 'One', url: 'https://one.example.com' },
          { title: 'Two', url: 'https://two.example.com' },
          { title: 'Three', url: 'https://three.example.com' },
          { title: 'Four', url: 'https://four.example.com' },
          { title: 'Five', url: 'https://five.example.com' },
        ],
      },
    ]);
  });

  it('preserves provider result order for broad discovery queries', async () => {
    mockGetSecure.mockImplementation((key: string) =>
      key === 'BRAVE_API_KEY' ? Promise.resolve('brave-key-123') : Promise.resolve(null),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [
            {
              title: 'OpenAI blog',
              url: 'https://openai.com/index/introducing-structured-outputs-in-the-api/',
            },
            {
              title: 'OpenAI docs',
              url: 'https://developers.openai.com/api/docs/guides/structured-outputs',
            },
            {
              title: 'Community writeup',
              url: 'https://dev.to/emcf/how-to-use-openais-new-structured-outputs-api-with-code-2enl',
            },
          ],
        },
      }),
    });

    const parsed = JSON.parse(
      await executeWebSearch({
        queries: ['OpenAI structured outputs developer documentation'],
      }),
    );

    expect(parsed.searches).toEqual([
      {
        query: 'OpenAI structured outputs developer documentation',
        results: [
          {
            title: 'OpenAI blog',
            url: 'https://openai.com/index/introducing-structured-outputs-in-the-api/',
          },
          {
            title: 'OpenAI docs',
            url: 'https://developers.openai.com/api/docs/guides/structured-outputs',
          },
          {
            title: 'Community writeup',
            url: 'https://dev.to/emcf/how-to-use-openais-new-structured-outputs-api-with-code-2enl',
          },
        ],
      },
    ]);
  });

  it('passes the query through without rewriting search operators', async () => {
    mockGetSecure.mockImplementation((key: string) =>
      key === 'BRAVE_API_KEY' ? Promise.resolve('brave-key-123') : Promise.resolve(null),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [
            {
              title: 'Responses reference',
              url: 'https://developers.openai.com/api/docs/api-reference/responses',
            },
            {
              title: 'Migration guide',
              url: 'https://developers.openai.com/api/docs/guides/migrate-to-responses',
            },
          ],
        },
      }),
    });

    const parsed = JSON.parse(
      await executeWebSearch({
        queries: ['site:platform.openai.com "Responses" api'],
      }),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [requestUrl] = mockFetch.mock.calls[0];
    expect(new URL(String(requestUrl)).searchParams.get('q')).toBe(
      'site:platform.openai.com "Responses" api',
    );
    expect(parsed.searches).toEqual([
      {
        query: 'site:platform.openai.com "Responses" api',
        results: [
          {
            title: 'Responses reference',
            url: 'https://developers.openai.com/api/docs/api-reference/responses',
          },
          {
            title: 'Migration guide',
            url: 'https://developers.openai.com/api/docs/guides/migrate-to-responses',
          },
        ],
      },
    ]);
  });

  it('deduplicates only exact repeated queries', async () => {
    mockGetSecure.mockImplementation((key: string) =>
      key === 'BRAVE_API_KEY' ? Promise.resolve('brave-key-123') : Promise.resolve(null),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [{ title: 'Responses reference', url: 'https://developers.openai.com/api/reference/responses/overview' }],
        },
      }),
    });

    const parsed = JSON.parse(
      await executeWebSearch({
        queries: ['site:openai.com "Responses" api', 'site:openai.com "Responses" api'],
      }),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(parsed.searches).toEqual([
      {
        query: 'site:openai.com "Responses" api',
        results: [
          {
            title: 'Responses reference',
            url: 'https://developers.openai.com/api/reference/responses/overview',
          },
        ],
      },
    ]);
  });

  it('uses Perplexity native search instead of chat completions', async () => {
    useSettingsStore.setState({ webSearchProvider: 'perplexity' } as any);
    mockGetSecure.mockImplementation((key: string) =>
      key === 'PERPLEXITY_API_KEY' ? Promise.resolve('pplx-test-key') : Promise.resolve(null),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: 'Responses overview', url: 'https://developers.openai.com/api/reference/responses/overview' },
          { title: 'Create response', url: 'https://developers.openai.com/api/reference/responses/create' },
        ],
      }),
    });

    const parsed = JSON.parse(
      await executeWebSearch({
        queries: ['site:developers.openai.com "Responses" api'],
        freshness: 'week',
        country: 'us',
        language: 'en',
      }),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = mockFetch.mock.calls[0];
    expect(requestUrl).toBe('https://api.perplexity.ai/search');
    const body = JSON.parse(String((requestInit as RequestInit).body));
    expect(body).toMatchObject({
      query: 'site:developers.openai.com "Responses" api',
      max_results: 5,
      search_recency_filter: 'week',
      country: 'US',
      search_language_filter: ['en'],
    });
    expect(body.search_domain_filter).toBeUndefined();
    expect(body.model).toBeUndefined();
    expect(body.messages).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
    expect(parsed.searches).toEqual([
      {
        query: 'site:developers.openai.com "Responses" api',
        results: [
          {
            title: 'Responses overview',
            url: 'https://developers.openai.com/api/reference/responses/overview',
          },
          {
            title: 'Create response',
            url: 'https://developers.openai.com/api/reference/responses/create',
          },
        ],
      },
    ]);
  });

  it('does not translate query text into xAI domain filters', async () => {
    useSettingsStore.setState({ webSearchProvider: 'grok' } as any);
    mockGetSecure.mockImplementation((key: string) =>
      key === 'XAI_API_KEY' ? Promise.resolve('xai-test-key') : Promise.resolve(null),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: [],
        citations: [
          'https://docs.anthropic.com/en/docs/claude-code/overview',
        ],
      }),
    });

    await executeWebSearch({
      queries: ['site:docs.anthropic.com "Claude Code" overview'],
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, requestInit] = mockFetch.mock.calls[0];
    const body = JSON.parse(String((requestInit as RequestInit).body));
    expect(body.tools).toEqual([
      {
        type: 'web_search',
      },
    ]);
    expect(body.input).toBe('site:docs.anthropic.com "Claude Code" overview');
  });

  it('retries abort-like transport failures once', async () => {
    mockGetSecure.mockImplementation((key: string) =>
      key === 'BRAVE_API_KEY' ? Promise.resolve('brave-key-123') : Promise.resolve(null),
    );

    const query = uniqueQuery('retry-abort');
    const originalDomException = (globalThis as any).DOMException;
    const abortError = new Error('AbortError');
    (globalThis as any).DOMException = undefined;

    try {
      mockFetch
        .mockRejectedValueOnce(abortError)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            web: {
              results: [{ title: 'Recovered', url: 'https://retry.example.com' }],
            },
          }),
        });

      const parsed = JSON.parse(await executeWebSearch({ queries: [query] }));
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(parsed.searches).toEqual([
        {
          query,
          results: [{ title: 'Recovered', url: 'https://retry.example.com' }],
        },
      ]);
    } finally {
      (globalThis as any).DOMException = originalDomException;
    }
  });

  it('returns cached results for a repeat query', async () => {
    mockGetSecure.mockImplementation((key: string) =>
      key === 'BRAVE_API_KEY' ? Promise.resolve('brave-key-123') : Promise.resolve(null),
    );

    const query = uniqueQuery('cache');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [{ title: 'Cached Result', url: 'https://cached.example.com' }],
        },
      }),
    });

    const first = JSON.parse(await executeWebSearch({ queries: [query] }));
    const second = JSON.parse(await executeWebSearch({ queries: [query] }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(first.searches).toEqual(second.searches);
  });
});
