import {
  DEFAULT_ANTHROPIC_SEARCH_MODEL,
  resolveAnthropicSearchTransport,
  resolveAnthropicWebSearchTool,
} from '../../src/engine/tools/webSearchAnthropicTransport';
import { resolveToolProviderContext } from '../../src/engine/tools/toolProviderContext';

jest.mock('../../src/engine/tools/toolProviderContext', () => ({
  resolveToolProviderContext: jest.fn(),
}));

const mockResolveToolProviderContext = resolveToolProviderContext as jest.MockedFunction<
  typeof resolveToolProviderContext
>;

describe('resolveAnthropicSearchTransport', () => {
  beforeEach(() => {
    mockResolveToolProviderContext.mockReset();
  });

  it('uses the enabled Anthropic provider apiKey and model', async () => {
    mockResolveToolProviderContext.mockResolvedValue({
      model: 'claude-opus-5',
      provider: {
        id: 'anthropic-primary',
        name: 'Anthropic',
        enabled: true,
        providerFamily: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'provider-key',
        model: 'claude-opus-5',
      } as any,
      allProviders: [],
    });

    await expect(resolveAnthropicSearchTransport({})).resolves.toMatchObject({
      model: 'claude-opus-5',
      provider: { apiKey: 'provider-key', baseUrl: 'https://api.anthropic.com/v1' },
    });
  });

  it('falls back to the default search model when the provider has no configured model', async () => {
    mockResolveToolProviderContext.mockResolvedValue({
      model: '',
      provider: {
        id: 'anthropic-primary',
        name: 'Anthropic',
        enabled: true,
        providerFamily: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'provider-key',
        model: '',
      } as any,
      allProviders: [],
    });

    await expect(resolveAnthropicSearchTransport({})).resolves.toMatchObject({
      model: DEFAULT_ANTHROPIC_SEARCH_MODEL,
    });
  });

  it('uses the fallback API key when no Anthropic provider is enabled', async () => {
    mockResolveToolProviderContext.mockResolvedValue({
      model: '',
      provider: null,
      allProviders: [],
    });

    await expect(
      resolveAnthropicSearchTransport({ fallbackApiKey: 'fallback-key' }),
    ).resolves.toMatchObject({
      model: DEFAULT_ANTHROPIC_SEARCH_MODEL,
      provider: { apiKey: 'fallback-key' },
    });
  });

  it('returns null when there is no Anthropic provider and no fallback key', async () => {
    mockResolveToolProviderContext.mockResolvedValue({
      model: '',
      provider: null,
      allProviders: [],
    });

    await expect(resolveAnthropicSearchTransport({})).resolves.toBeNull();
  });

  it('ignores a non-Anthropic active provider and searches allProviders instead', async () => {
    mockResolveToolProviderContext.mockResolvedValue({
      model: 'gpt-5.4',
      provider: {
        id: 'openai-primary',
        name: 'OpenAI',
        enabled: true,
        providerFamily: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'openai-key',
        model: 'gpt-5.4',
      } as any,
      allProviders: [
        {
          id: 'anthropic-secondary',
          name: 'Anthropic',
          enabled: true,
          providerFamily: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-sonnet-5',
        } as any,
      ],
    });

    await expect(resolveAnthropicSearchTransport({})).resolves.toMatchObject({
      model: 'claude-sonnet-5',
      provider: { apiKey: 'anthropic-key' },
    });
  });
});

describe('resolveAnthropicWebSearchTool', () => {
  it('uses the dynamic-filtering tool for Claude 4.6 and later', () => {
    expect(resolveAnthropicWebSearchTool('claude-sonnet-4-6')).toEqual({
      type: 'web_search_20260209',
      name: 'web_search',
      max_uses: 3,
      allowed_callers: ['direct'],
    });
  });

  it('uses the dynamic-filtering tool for a Claude 5.x model', () => {
    expect(resolveAnthropicWebSearchTool('claude-opus-5')).toMatchObject({
      type: 'web_search_20260209',
    });
  });

  it('uses the basic tool for a Claude model older than 4.6', () => {
    expect(resolveAnthropicWebSearchTool('claude-haiku-4-5')).toEqual({
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 3,
      allowed_callers: ['direct'],
    });
  });

  it('uses the basic tool for an unrecognized model id', () => {
    expect(resolveAnthropicWebSearchTool('some-custom-model')).toMatchObject({
      type: 'web_search_20250305',
    });
  });
});
