import { executeWebSearch } from '../../src/engine/tools/web-search';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { parseCompletedToolOutcome } from '../helpers/toolRuntimeOutcome';
import {
  mockSecureKey,
  resetWebSearchTestState,
  uniqueWebSearchQuery,
} from '../helpers/webSearchFixtures';

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

describe('executeWebSearch provider fallback and resilience', () => {
  it('auto-selects OpenRouter search only after Gemini, Anthropic, and OpenAI have no key', async () => {
    useSettingsStore.setState({
      providers: [
        {
          id: 'openrouter-1',
          name: 'OpenRouter',
          enabled: true,
          providerFamily: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-or-test',
          model: 'openai/gpt-5.4',
        },
      ],
      activeProviderId: 'openrouter-1',
      activeModel: 'openai/gpt-5.4',
    } as any);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'found it',
              annotations: [
                {
                  type: 'url_citation',
                  url_citation: { url: 'https://openrouter.ai/x', title: 'OpenRouter docs', content: '' },
                },
              ],
            },
          },
        ],
      }),
    });

    const parsed = parseCompletedToolOutcome(
      await executeWebSearch({ queries: ['openrouter web search auto selection'] }),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [requestUrl] = mockFetch.mock.calls[0];
    expect(requestUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(parsed.provider).toBe('openrouter');
    expect(parsed.searches).toEqual([
      {
        query: 'openrouter web search auto selection',
        results: [{ title: 'OpenRouter docs', url: 'https://openrouter.ai/x' }],
      },
    ]);
  });

  it('prefers a dedicated Brave key over the OpenRouter LLM-key fallback in auto mode', async () => {
    mockSecureKey(mockGetSecure, 'BRAVE_API_KEY', 'brave-key-123');
    useSettingsStore.setState({
      providers: [
        {
          id: 'openrouter-1',
          name: 'OpenRouter',
          enabled: true,
          providerFamily: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-or-test',
          model: 'openai/gpt-5.4',
        },
      ],
      activeProviderId: 'openrouter-1',
      activeModel: 'openai/gpt-5.4',
    } as any);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ web: { results: [{ title: 'Brave result', url: 'https://brave.example.com' }] } }),
    });

    const parsed = parseCompletedToolOutcome(
      await executeWebSearch({ queries: ['dedicated key beats llm key fallback'] }),
    );

    expect(parsed.provider).toBe('brave');
  });

  it('honors an explicit openrouter provider pin even when a dedicated Brave key exists', async () => {
    useSettingsStore.setState({
      webSearchProvider: 'openrouter',
      providers: [
        {
          id: 'openrouter-1',
          name: 'OpenRouter',
          enabled: true,
          providerFamily: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-or-test',
          model: 'openai/gpt-5.4',
        },
      ],
      activeProviderId: 'openrouter-1',
      activeModel: 'openai/gpt-5.4',
    } as any);
    mockSecureKey(mockGetSecure, 'BRAVE_API_KEY', 'brave-key-123');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '', annotations: [] } }],
      }),
    });

    const parsed = parseCompletedToolOutcome(
      await executeWebSearch({ queries: ['explicit openrouter pin'] }),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [requestUrl] = mockFetch.mock.calls[0];
    expect(requestUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(parsed.provider).toBe('openrouter');
  });

  it('retries abort-like transport failures once', async () => {
    mockSecureKey(mockGetSecure, 'BRAVE_API_KEY', 'brave-key-123');

    const query = uniqueWebSearchQuery('retry-abort');
    const originalDomException = (globalThis as any).DOMException;
    const abortError = new Error('AbortError');
    (globalThis as any).DOMException = undefined;

    try {
      mockFetch.mockRejectedValueOnce(abortError).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          web: {
            results: [{ title: 'Recovered', url: 'https://retry.example.com' }],
          },
        }),
      });

      const parsed = parseCompletedToolOutcome(await executeWebSearch({ queries: [query] }));
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
    mockSecureKey(mockGetSecure, 'BRAVE_API_KEY', 'brave-key-123');

    const query = uniqueWebSearchQuery('cache');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [{ title: 'Cached Result', url: 'https://cached.example.com' }],
        },
      }),
    });

    const first = parseCompletedToolOutcome(await executeWebSearch({ queries: [query] }));
    const second = parseCompletedToolOutcome(await executeWebSearch({ queries: [query] }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(first.searches).toEqual(second.searches);
  });
});
