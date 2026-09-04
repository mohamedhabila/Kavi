import { searchOpenAI } from '../../src/engine/tools/webSearchOpenAI';
import { resolveOpenAISearchTransport } from '../../src/engine/tools/webSearchOpenAITransport';
import { classifyProviderError } from '../../src/services/llm/support/providerErrorClassification';

jest.mock('../../src/engine/tools/webSearchOpenAITransport', () => ({
  resolveOpenAISearchTransport: jest.fn(),
}));

const mockResolveTransport = resolveOpenAISearchTransport as jest.MockedFunction<
  typeof resolveOpenAISearchTransport
>;

const mockFetch = jest.fn();
const originalFetch = global.fetch;

const TEST_PROVIDER = {
  id: 'openai-1',
  name: 'OpenAI',
  providerFamily: 'openai' as const,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-openai-test',
  model: 'gpt-5.4',
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

describe('searchOpenAI', () => {
  it('parses url_citation annotations from message output items into results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: [
          { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'q' } },
          {
            type: 'message',
            id: 'msg_1',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Here is what I found.',
                annotations: [
                  {
                    type: 'url_citation',
                    start_index: 0,
                    end_index: 10,
                    url: 'https://a.example.com',
                    title: 'A result',
                  },
                  {
                    type: 'url_citation',
                    start_index: 11,
                    end_index: 20,
                    url: 'https://b.example.com',
                    title: 'B result',
                  },
                ],
              },
            ],
          },
        ],
      }),
    });

    const result = await searchOpenAI({ query: 'test query', count: 5, apiKey: 'unused' });

    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-5.4');
    expect(result.results).toEqual([
      { title: 'A result', url: 'https://a.example.com', description: 'Here is what I found.' },
      { title: 'B result', url: 'https://b.example.com', description: 'Here is what I found.' },
    ]);
  });

  it('deduplicates repeated citation urls across message parts', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'first',
                annotations: [
                  { type: 'url_citation', url: 'https://a.example.com', title: 'A' },
                  { type: 'url_citation', url: 'https://a.example.com', title: 'A again' },
                ],
              },
            ],
          },
        ],
      }),
    });

    const result = await searchOpenAI({ query: 'test query', count: 5, apiKey: 'unused' });

    expect(result.results).toEqual([
      { title: 'A', url: 'https://a.example.com', description: 'first' },
    ]);
  });

  it('sends the documented request shape', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ output: [] }) });

    await searchOpenAI({ query: 'positive news today', count: 5, apiKey: 'unused' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = mockFetch.mock.calls[0];
    expect(requestUrl).toBe('https://api.openai.com/v1/responses');
    expect((requestInit.headers as Record<string, string>).Authorization).toBe('Bearer sk-openai-test');

    const body = JSON.parse(String(requestInit.body));
    expect(body.model).toBe('gpt-5.4');
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(body.input).toContain('positive news today');
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
      await searchOpenAI({ query: 'test query', count: 5, apiKey: 'unused' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const classification = classifyProviderError(caught);
    expect(classification.kind).toBe('rate_limited');
    expect(classification.classifiedBy).toBe('status');
    expect(classification.retryable).toBe(true);
  });

  it('throws when no OpenAI transport can be resolved', async () => {
    mockResolveTransport.mockResolvedValueOnce(null);

    await expect(searchOpenAI({ query: 'q', count: 5, apiKey: '' })).rejects.toThrow(
      'OpenAI search is not configured.',
    );
  });
});
