import { executeWebSearch } from '../../src/engine/tools/web-search';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { parseCompletedToolOutcome } from '../helpers/toolRuntimeOutcome';
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

describe('executeWebSearch provider payload normalization', () => {
  it('preserves provider result order for broad discovery queries', async () => {
    mockSecureKey(mockGetSecure, 'BRAVE_API_KEY', 'brave-key-123');

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

    const parsed = parseCompletedToolOutcome(
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
    mockSecureKey(mockGetSecure, 'BRAVE_API_KEY', 'brave-key-123');

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

    const parsed = parseCompletedToolOutcome(
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
    mockSecureKey(mockGetSecure, 'BRAVE_API_KEY', 'brave-key-123');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [
            {
              title: 'Responses reference',
              url: 'https://developers.openai.com/api/reference/responses/overview',
            },
          ],
        },
      }),
    });

    const parsed = parseCompletedToolOutcome(
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
    mockSecureKey(mockGetSecure, 'PERPLEXITY_API_KEY', 'pplx-test-key');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
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
      }),
    });

    const parsed = parseCompletedToolOutcome(
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
    mockSecureKey(mockGetSecure, 'XAI_API_KEY', 'xai-test-key');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: [],
        citations: ['https://docs.anthropic.com/en/docs/claude-code/overview'],
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

  it('auto-selects Anthropic search when only an Anthropic LLM provider is enabled', async () => {
    useSettingsStore.setState({
      providers: [
        {
          id: 'anthropic-1',
          name: 'Anthropic',
          enabled: true,
          providerFamily: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'sk-ant-test',
          model: 'claude-opus-5',
        },
      ],
      activeProviderId: 'anthropic-1',
      activeModel: 'claude-opus-5',
    } as any);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_1',
            content: [
              {
                type: 'web_search_result',
                url: 'https://docs.anthropic.com/x',
                title: 'Anthropic docs',
              },
            ],
          },
        ],
      }),
    });

    const parsed = parseCompletedToolOutcome(
      await executeWebSearch({ queries: ['anthropic web search auto selection'] }),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [requestUrl] = mockFetch.mock.calls[0];
    expect(requestUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(parsed.provider).toBe('anthropic');
    expect(parsed.searches).toEqual([
      {
        query: 'anthropic web search auto selection',
        results: [{ title: 'Anthropic docs', url: 'https://docs.anthropic.com/x' }],
      },
    ]);
  });

  it('auto-selects OpenAI search when only an OpenAI LLM provider is enabled', async () => {
    useSettingsStore.setState({
      providers: [
        {
          id: 'openai-1',
          name: 'OpenAI',
          enabled: true,
          providerFamily: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai-test',
          model: 'gpt-5.4',
        },
      ],
      activeProviderId: 'openai-1',
      activeModel: 'gpt-5.4',
    } as any);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'found it',
                annotations: [
                  {
                    type: 'url_citation',
                    url: 'https://platform.openai.com/x',
                    title: 'OpenAI docs',
                  },
                ],
              },
            ],
          },
        ],
      }),
    });

    const parsed = parseCompletedToolOutcome(
      await executeWebSearch({ queries: ['openai web search auto selection'] }),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [requestUrl] = mockFetch.mock.calls[0];
    expect(requestUrl).toBe('https://api.openai.com/v1/responses');
    expect(parsed.provider).toBe('openai');
    expect(parsed.searches).toEqual([
      {
        query: 'openai web search auto selection',
        results: [{ title: 'OpenAI docs', url: 'https://platform.openai.com/x' }],
      },
    ]);
  });
});
