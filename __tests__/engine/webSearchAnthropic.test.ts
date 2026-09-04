import { searchAnthropic } from '../../src/engine/tools/webSearchAnthropic';
import { resolveAnthropicSearchTransport } from '../../src/engine/tools/webSearchAnthropicTransport';
import { classifyProviderError } from '../../src/services/llm/support/providerErrorClassification';

jest.mock('../../src/engine/tools/webSearchAnthropicTransport', () => {
  const actual = jest.requireActual('../../src/engine/tools/webSearchAnthropicTransport');
  return {
    ...actual,
    resolveAnthropicSearchTransport: jest.fn(),
  };
});

const mockResolveTransport = resolveAnthropicSearchTransport as jest.MockedFunction<
  typeof resolveAnthropicSearchTransport
>;

const mockFetch = jest.fn();
const originalFetch = global.fetch;

const TEST_PROVIDER = {
  id: 'anthropic-1',
  name: 'Anthropic',
  providerFamily: 'anthropic' as const,
  baseUrl: 'https://api.anthropic.com/v1',
  apiKey: 'sk-ant-test',
  model: 'claude-opus-5',
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

describe('searchAnthropic', () => {
  it('parses a successful web_search_tool_result list, preferring cited text over page_age for descriptions', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: "I'll search for that." },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_1',
            content: [
              {
                type: 'web_search_result',
                url: 'https://a.example.com',
                title: 'A',
                page_age: 'April 30, 2025',
              },
              {
                type: 'web_search_result',
                url: 'https://b.example.com',
                title: 'B',
                page_age: 'May 1, 2025',
              },
            ],
          },
          {
            type: 'text',
            text: 'A explains it well.',
            citations: [
              {
                type: 'web_search_result_location',
                url: 'https://a.example.com',
                title: 'A',
                cited_text: 'The definitive explanation.',
              },
            ],
          },
        ],
      }),
    });

    const result = await searchAnthropic({ query: 'test query', count: 5, apiKey: 'unused' });

    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-opus-5');
    expect(result.results).toEqual([
      { title: 'A', url: 'https://a.example.com', description: 'The definitive explanation.' },
      { title: 'B', url: 'https://b.example.com', description: 'Last updated May 1, 2025' },
    ]);
  });

  it('treats a web_search_tool_result error object as an empty, non-throwing result', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'Trying to search.' },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_1',
            content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' },
          },
        ],
      }),
    });

    const result = await searchAnthropic({ query: 'test query', count: 5, apiKey: 'unused' });

    expect(result.results).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.reason).toContain('max_uses_exceeded');
  });

  it('sends the documented tool definition and search prompt', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ content: [] }) });

    await searchAnthropic({ query: 'weather in NYC', count: 5, apiKey: 'unused' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = mockFetch.mock.calls[0];
    expect(requestUrl).toBe('https://api.anthropic.com/v1/messages');
    expect((requestInit.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
    expect((requestInit.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(String(requestInit.body));
    expect(body.model).toBe('claude-opus-5');
    expect(body.tools).toEqual([
      { type: 'web_search_20260209', name: 'web_search', max_uses: 3, allowed_callers: ['direct'] },
    ]);
    expect(body.messages[0].content).toContain('weather in NYC');
  });

  it('classifies a 429 response as rate_limited through the structured error path', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () =>
        JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }),
    });

    let caught: unknown;
    try {
      await searchAnthropic({ query: 'test query', count: 5, apiKey: 'unused' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const classification = classifyProviderError(caught);
    expect(classification.kind).toBe('rate_limited');
    expect(classification.classifiedBy).toBe('structured');
    expect(classification.retryable).toBe(true);
  });

  it('throws when no Anthropic transport can be resolved', async () => {
    mockResolveTransport.mockResolvedValueOnce(null);

    await expect(searchAnthropic({ query: 'q', count: 5, apiKey: '' })).rejects.toThrow(
      'Anthropic search is not configured.',
    );
  });
});
