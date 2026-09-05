import { searchOpenRouter } from '../../src/engine/tools/webSearchOpenRouter';
import { resolveOpenRouterSearchTransport } from '../../src/engine/tools/webSearchOpenRouterTransport';
import { classifyProviderError } from '../../src/services/llm/support/providerErrorClassification';

jest.mock('../../src/engine/tools/webSearchOpenRouterTransport', () => ({
  resolveOpenRouterSearchTransport: jest.fn(),
}));

const mockResolveTransport = resolveOpenRouterSearchTransport as jest.MockedFunction<
  typeof resolveOpenRouterSearchTransport
>;

const mockFetch = jest.fn();
const originalFetch = global.fetch;

const TEST_PROVIDER = {
  id: 'openrouter-1',
  name: 'OpenRouter',
  providerFamily: 'openrouter' as const,
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-or-test',
  model: 'openai/gpt-5.4',
  enabled: true,
};

beforeEach(() => {
  mockFetch.mockReset();
  mockResolveTransport.mockReset();
  global.fetch = mockFetch;
  mockResolveTransport.mockResolvedValue({ provider: TEST_PROVIDER, model: TEST_PROVIDER.model });
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('searchOpenRouter', () => {
  it('parses nested url_citation annotations from the chat completions response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: "Here's the latest news I found: ...",
              annotations: [
                {
                  type: 'url_citation',
                  url_citation: {
                    url: 'https://a.example.com',
                    title: 'A result',
                    content: 'Snippet A',
                    start_index: 0,
                    end_index: 10,
                  },
                },
                {
                  type: 'url_citation',
                  url_citation: {
                    url: 'https://b.example.com',
                    title: 'B result',
                    content: 'Snippet B',
                    start_index: 11,
                    end_index: 20,
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await searchOpenRouter({ query: 'test query', count: 5, apiKey: 'unused' });

    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('openai/gpt-5.4');
    expect(result.results).toEqual([
      { title: 'A result', url: 'https://a.example.com', description: 'Snippet A' },
      { title: 'B result', url: 'https://b.example.com', description: 'Snippet B' },
    ]);
    expect(result.citations).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('deduplicates repeated citation urls across annotations', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'first',
              annotations: [
                {
                  type: 'url_citation',
                  url_citation: { url: 'https://a.example.com', title: 'A', content: 'x' },
                },
                {
                  type: 'url_citation',
                  url_citation: { url: 'https://a.example.com', title: 'A again', content: 'y' },
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await searchOpenRouter({ query: 'test query', count: 5, apiKey: 'unused' });

    expect(result.results).toEqual([{ title: 'A', url: 'https://a.example.com', description: 'x' }]);
  });

  it('falls back to citation-backfilled results on an empty-annotation reply', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'No sources were found for that query.',
              annotations: [],
            },
          },
        ],
      }),
    });

    const result = await searchOpenRouter({ query: 'obscure query', count: 5, apiKey: 'unused' });

    expect(result.provider).toBe('openrouter');
    expect(result.results).toEqual([]);
    expect(result.citations).toEqual([]);
  });

  it('sends the documented plugins request shape', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '', annotations: [] } }] }),
    });

    await searchOpenRouter({ query: 'positive news today', count: 5, apiKey: 'unused' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = mockFetch.mock.calls[0];
    expect(requestUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((requestInit.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-test');

    const body = JSON.parse(String(requestInit.body));
    expect(body.model).toBe('openai/gpt-5.4');
    expect(body.plugins).toEqual([{ id: 'web' }]);
    expect(body.messages).toEqual([
      { role: 'user', content: expect.stringContaining('positive news today') },
    ]);
  });

  it('classifies a 429 response as rate_limited through the structured error path', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () =>
        JSON.stringify({ error: { type: 'requests', code: 'rate_limit_exceeded', message: 'slow down' } }),
    });

    let caught: unknown;
    try {
      await searchOpenRouter({ query: 'test query', count: 5, apiKey: 'unused' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const classification = classifyProviderError(caught);
    expect(classification.kind).toBe('rate_limited');
    expect(classification.classifiedBy).toBe('status');
    expect(classification.retryable).toBe(true);
  });

  it('throws when no OpenRouter transport can be resolved', async () => {
    mockResolveTransport.mockResolvedValueOnce(null);

    await expect(searchOpenRouter({ query: 'q', count: 5, apiKey: '' })).rejects.toThrow(
      'OpenRouter search is not configured.',
    );
  });
});
