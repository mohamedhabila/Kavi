import { DEFAULT_GEMINI_BASE_URL, DEFAULT_OPENAI_BASE_URL } from '../../src/constants/api';
import {
  DEFAULT_E2E_ANTHROPIC_BASE_URL,
  DEFAULT_E2E_OPENROUTER_BASE_URL,
  buildE2EProviderForKey,
  buildE2EProvider,
  resolveE2EProviderKey,
} from '../../src/acceptance/e2eAgent/providerConfig';
import { resolveProviderTransport } from '../../src/services/llm/catalog/providerProtocols';

describe('E2E provider config transport', () => {
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const previousGeminiBaseUrl = process.env.GEMINI_BASE_URL;
  const previousOpenAIKey = process.env.OPENAI_API_KEY;
  const previousOpenAIModel = process.env.E2E_OPENAI_MODEL;
  const previousOpenAIBaseUrl = process.env.OPENAI_BASE_URL;
  const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const previousAnthropicModel = process.env.E2E_ANTHROPIC_MODEL;
  const previousAnthropicBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const previousOpenRouterModel = process.env.E2E_OPENROUTER_MODEL;
  const previousOpenRouterBaseUrl = process.env.OPENROUTER_BASE_URL;
  const previousCompatibleKey = process.env.E2E_COMPATIBLE_API_KEY;
  const previousCompatibleModel = process.env.E2E_COMPATIBLE_MODEL;
  const previousCompatibleBaseUrl = process.env.E2E_COMPATIBLE_BASE_URL;
  const previousProvider = process.env.E2E_PROVIDER;
  const previousProviderFamily = process.env.E2E_PROVIDER_FAMILY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    delete process.env.GEMINI_BASE_URL;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.E2E_OPENAI_MODEL = 'gpt-test-model';
    delete process.env.OPENAI_BASE_URL;
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.E2E_ANTHROPIC_MODEL = 'claude-test-model';
    delete process.env.ANTHROPIC_BASE_URL;
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    process.env.E2E_OPENROUTER_MODEL = 'openai/gpt-test-model';
    delete process.env.OPENROUTER_BASE_URL;
    process.env.E2E_COMPATIBLE_API_KEY = 'test-compatible-key';
    process.env.E2E_COMPATIBLE_MODEL = 'compatible-test-model';
    process.env.E2E_COMPATIBLE_BASE_URL = 'https://compatible.example/v1';
    delete process.env.E2E_PROVIDER;
    delete process.env.E2E_PROVIDER_FAMILY;
  });

  afterEach(() => {
    if (previousGeminiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = previousGeminiKey;
    }
    if (previousGeminiBaseUrl === undefined) {
      delete process.env.GEMINI_BASE_URL;
    } else {
      process.env.GEMINI_BASE_URL = previousGeminiBaseUrl;
    }
    if (previousOpenAIKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousOpenAIKey;
    }
    if (previousOpenAIModel === undefined) {
      delete process.env.E2E_OPENAI_MODEL;
    } else {
      process.env.E2E_OPENAI_MODEL = previousOpenAIModel;
    }
    if (previousOpenAIBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = previousOpenAIBaseUrl;
    }
    if (previousAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
    if (previousAnthropicModel === undefined) {
      delete process.env.E2E_ANTHROPIC_MODEL;
    } else {
      process.env.E2E_ANTHROPIC_MODEL = previousAnthropicModel;
    }
    if (previousAnthropicBaseUrl === undefined) {
      delete process.env.ANTHROPIC_BASE_URL;
    } else {
      process.env.ANTHROPIC_BASE_URL = previousAnthropicBaseUrl;
    }
    if (previousOpenRouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
    }
    if (previousOpenRouterModel === undefined) {
      delete process.env.E2E_OPENROUTER_MODEL;
    } else {
      process.env.E2E_OPENROUTER_MODEL = previousOpenRouterModel;
    }
    if (previousOpenRouterBaseUrl === undefined) {
      delete process.env.OPENROUTER_BASE_URL;
    } else {
      process.env.OPENROUTER_BASE_URL = previousOpenRouterBaseUrl;
    }
    if (previousCompatibleKey === undefined) {
      delete process.env.E2E_COMPATIBLE_API_KEY;
    } else {
      process.env.E2E_COMPATIBLE_API_KEY = previousCompatibleKey;
    }
    if (previousCompatibleModel === undefined) {
      delete process.env.E2E_COMPATIBLE_MODEL;
    } else {
      process.env.E2E_COMPATIBLE_MODEL = previousCompatibleModel;
    }
    if (previousCompatibleBaseUrl === undefined) {
      delete process.env.E2E_COMPATIBLE_BASE_URL;
    } else {
      process.env.E2E_COMPATIBLE_BASE_URL = previousCompatibleBaseUrl;
    }
    if (previousProvider === undefined) {
      delete process.env.E2E_PROVIDER;
    } else {
      process.env.E2E_PROVIDER = previousProvider;
    }
    if (previousProviderFamily === undefined) {
      delete process.env.E2E_PROVIDER_FAMILY;
    } else {
      process.env.E2E_PROVIDER_FAMILY = previousProviderFamily;
    }
  });

  it('routes live E2E through native Gemini transport on the default Vertex base URL', () => {
    const provider = buildE2EProviderForKey('gemini');
    expect(provider.baseUrl).toBe(DEFAULT_GEMINI_BASE_URL);
    expect(resolveProviderTransport(provider)).toBe('gemini');
  });

  it('routes live E2E through OpenAI transport when selected', () => {
    process.env.E2E_PROVIDER = 'openai';
    const provider = buildE2EProvider();
    expect(provider.id).toBe('e2e-openai');
    expect(provider.baseUrl).toBe(DEFAULT_OPENAI_BASE_URL);
    expect(provider.model).toBe('gpt-test-model');
    expect(provider.providerFamily).toBe('openai');
    expect(resolveProviderTransport(provider)).toBe('openai');
  });

  it('builds OpenAI directly from OPENAI_API_KEY and E2E_OPENAI_MODEL', () => {
    const provider = buildE2EProviderForKey('openai');
    expect(provider.apiKey).toBe('test-openai-key');
    expect(provider.model).toBe('gpt-test-model');
    expect(provider.providerFamily).toBe('openai');
  });

  it('routes live E2E through native Anthropic Messages transport when selected', () => {
    process.env.E2E_PROVIDER = 'claude';
    const provider = buildE2EProvider();
    expect(resolveE2EProviderKey()).toBe('anthropic');
    expect(provider.id).toBe('e2e-anthropic');
    expect(provider.apiKey).toBe('test-anthropic-key');
    expect(provider.model).toBe('claude-test-model');
    expect(provider.baseUrl).toBe(DEFAULT_E2E_ANTHROPIC_BASE_URL);
    expect(provider.providerFamily).toBe('anthropic');
    expect(resolveProviderTransport(provider)).toBe('anthropic');
  });

  it('builds OpenRouter with OpenAI-compatible transport metadata', () => {
    process.env.E2E_PROVIDER = 'openrouter';
    const provider = buildE2EProvider();
    expect(resolveE2EProviderKey()).toBe('openrouter');
    expect(provider.apiKey).toBe('test-openrouter-key');
    expect(provider.baseUrl).toBe(DEFAULT_E2E_OPENROUTER_BASE_URL);
    expect(provider.providerFamily).toBe('openrouter');
    expect(resolveProviderTransport(provider)).toBe('compatible');
  });

  it('builds generic OpenAI-compatible providers from explicit env', () => {
    process.env.E2E_PROVIDER = 'openai-compatible';
    const provider = buildE2EProvider();
    expect(resolveE2EProviderKey()).toBe('compatible');
    expect(provider.apiKey).toBe('test-compatible-key');
    expect(provider.model).toBe('compatible-test-model');
    expect(provider.baseUrl).toBe('https://compatible.example/v1');
    expect(provider.providerFamily).toBe('custom');
    expect(resolveProviderTransport(provider)).toBe('compatible');
  });
});
