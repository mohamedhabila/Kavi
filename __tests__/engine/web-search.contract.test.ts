import { executeWebSearch, WEB_SEARCH_TOOL } from '../../src/engine/tools/web-search';
import { parseCompletedToolOutcome, parseFailedToolOutcome } from '../helpers/toolRuntimeOutcome';
import { mockSecureKey, resetWebSearchTestState } from '../helpers/webSearchFixtures';

const mockGetSecure = jest.fn();
const mockGetProviderApiKey = jest.fn();
jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
  getProviderApiKey: (...args: any[]) => mockGetProviderApiKey(...args),
}));

const mockFetch = jest.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  resetWebSearchTestState({ mockFetch, mockGetSecure, mockGetProviderApiKey });
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('executeWebSearch contract and Brave request shaping', () => {
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
    const missing = parseFailedToolOutcome(await executeWebSearch({}));
    expect(missing.error).toBe('At least one search query is required');

    const empty = parseFailedToolOutcome(await executeWebSearch({ queries: [''] }));
    expect(empty.error).toBe('At least one search query is required');
  });

  it('fails closed when no search provider is configured, and tells the model to use web_fetch instead of naming Settings', async () => {
    const parsed = parseFailedToolOutcome(await executeWebSearch({ queries: ['test query'] }));
    expect(parsed.error).toContain('Web search is unavailable: no search provider is configured.');
    expect(parsed.error).toContain('Use web_fetch on a public source instead');
    expect(parsed.error).toContain('geocoding-api.open-meteo.com/v1/search');
    expect(parsed.error).toContain('api.open-meteo.com/v1/forecast');
    expect(parsed.error).toContain('wikipedia.org/api/rest_v1/page/summary');
    // The settings hint is a UI concern, not a model-facing instruction.
    expect(parsed.error).not.toContain('Add an API key in Settings');
  });

  it('returns the canonical shallow searches payload for a single query', async () => {
    mockSecureKey(mockGetSecure, 'BRAVE_API_KEY', 'brave-key-123');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [{ title: 'Result 1', url: 'https://r1.com', description: 'ignored summary' }],
        },
      }),
    });

    const parsed = parseCompletedToolOutcome(
      await executeWebSearch({ queries: ['canonical single query'] }),
    );

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
    mockSecureKey(mockGetSecure, 'BRAVE_API_KEY', 'brave-key-123');

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

    const parsed = parseCompletedToolOutcome(
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
    mockSecureKey(mockGetSecure, 'BRAVE_API_KEY', 'brave-key-123');

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
    mockSecureKey(mockGetSecure, 'BRAVE_API_KEY', 'brave-key-123');

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

    const parsed = parseCompletedToolOutcome(await executeWebSearch({ queries: ['top 5 only'] }));

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
});
