import {
  normalizeHostedModelId,
  resolveProviderFamily,
  resolveModelHostedFamily,
} from '../../src/services/llm/catalog/providerFamilies';
import {
  resolveProviderProtocol,
  resolveProviderTransport,
} from '../../src/services/llm/catalog/providerProtocols';
import {
  PRIMARY_GEMINI_IMAGE_MODEL,
  PRIMARY_OPENAI_IMAGE_MODEL,
  resolveImageModel,
} from '../../src/services/llm/images/modelPolicy';
import { isProviderModelSupported } from '../../src/services/llm/support/providerSupport';
import type { LlmProviderConfig } from '../../src/types/provider';

const makeProvider = (overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig => ({
  id: 'provider',
  name: 'Provider',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
  enabled: true,
  ...overrides,
});

describe('llm provider catalog', () => {
  it('detects provider families for first-class compatible providers', () => {
    expect(
      resolveProviderFamily(
        makeProvider({ name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' }),
      ),
    ).toBe('openrouter');
    expect(
      resolveProviderFamily(
        makeProvider({ name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' }),
      ),
    ).toBe('deepseek');
    expect(
      resolveProviderFamily(
        makeProvider({
          name: 'Qwen',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        }),
      ),
    ).toBe('qwen');
    expect(
      resolveProviderFamily(makeProvider({ name: 'Kimi', baseUrl: 'https://api.moonshot.ai/v1' })),
    ).toBe('kimi');
    expect(
      resolveProviderFamily(
        makeProvider({ name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' }),
      ),
    ).toBe('mistral');
    expect(
      resolveProviderFamily(
        makeProvider({ name: 'Voyage', baseUrl: 'https://api.voyageai.com/v1' }),
      ),
    ).toBe('voyage');
  });

  it('detects hosted model families for common interfaces', () => {
    expect(resolveModelHostedFamily('openai/gpt-5.4')).toBe('openai');
    expect(resolveModelHostedFamily('anthropic/claude-sonnet-4-6')).toBe('anthropic');
    expect(resolveModelHostedFamily('google/gemini-3.5-flash')).toBe('gemini');
    expect(resolveModelHostedFamily('deepseek/deepseek-v3')).toBe('deepseek');
    expect(resolveModelHostedFamily('qwen/qwen3')).toBe('qwen');
    expect(resolveModelHostedFamily('kimi/kimi-k2.5')).toBe('kimi');
    expect(resolveModelHostedFamily('models/gemini-3-flash-preview')).toBe('gemini');
    expect(
      resolveModelHostedFamily(
        'projects/demo/locations/us-central1/publishers/google/models/gemini-3.5-flash',
      ),
    ).toBe('gemini');
    expect(resolveModelHostedFamily('openrouter/google/gemini-3.5-flash')).toBe('gemini');
  });

  it('normalizes hosted model ids to their canonical leaf segment', () => {
    expect(normalizeHostedModelId('openai/gpt-5.4')).toBe('gpt-5.4');
    expect(normalizeHostedModelId('models/gemini-3-flash-preview')).toBe('gemini-3-flash-preview');
    expect(
      normalizeHostedModelId(
        'projects/demo/locations/us-central1/publishers/google/models/gemini-3.5-flash',
      ),
    ).toBe('gemini-3.5-flash');
    expect(normalizeHostedModelId('openrouter/google/gemini-3.5-flash')).toBe('gemini-3.5-flash');
  });

  it('resolves protocols for native and compatible providers', () => {
    expect(
      resolveProviderProtocol(
        makeProvider({ name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' }),
      ),
    ).toBe('openai-responses');
    expect(
      resolveProviderProtocol(
        makeProvider({ name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' }),
      ),
    ).toBe('openai-chat');
    expect(
      resolveProviderProtocol(
        makeProvider({
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        }),
      ),
    ).toBe('gemini-native');
    expect(
      resolveProviderProtocol(
        makeProvider({
          name: 'Internal gateway',
          providerFamily: 'gemini',
          baseUrl: 'https://gateway.example.com/v1',
        }),
      ),
    ).toBe('gemini-native');
    expect(
      resolveProviderProtocol(
        makeProvider({ name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic' }),
      ),
    ).toBe('anthropic-messages');
  });

  it('maps provider protocols back to the current transport layer', () => {
    expect(
      resolveProviderTransport(
        makeProvider({ name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' }),
      ),
    ).toBe('openai');
    expect(
      resolveProviderTransport(
        makeProvider({ name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' }),
      ),
    ).toBe('compatible');
    expect(
      resolveProviderTransport(
        makeProvider({
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        }),
      ),
    ).toBe('gemini');
  });

  it('allows general compatible providers to host multiple model families', () => {
    const openRouter = makeProvider({
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-5.4',
      availableModels: [],
      hiddenModels: [],
    });
    const kimi = makeProvider({
      name: 'Kimi',
      baseUrl: 'https://api.moonshot.ai/v1',
      model: 'kimi/kimi-k2.5',
      availableModels: [],
      hiddenModels: [],
    });

    expect(isProviderModelSupported(openRouter, 'anthropic/claude-sonnet-4-6')).toBe(true);
    expect(isProviderModelSupported(openRouter, 'google/gemini-3.5-flash')).toBe(true);
    expect(isProviderModelSupported(kimi, 'qwen/qwen3')).toBe(true);
  });

  it('uses current image defaults and normalizes preview aliases', () => {
    expect(
      resolveImageModel(
        makeProvider({ name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '' }),
      ),
    ).toBe(PRIMARY_OPENAI_IMAGE_MODEL);
    expect(
      resolveImageModel(
        makeProvider({
          name: 'Gemini',
          providerFamily: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          model: '',
        }),
      ),
    ).toBe(PRIMARY_GEMINI_IMAGE_MODEL);
    expect(
      resolveImageModel(
        makeProvider({
          name: 'Gemini',
          providerFamily: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          model: 'gemini-3.1-flash-image-preview',
        }),
      ),
    ).toBe(PRIMARY_GEMINI_IMAGE_MODEL);
  });

  it('uses explicit provider family metadata for image defaults without re-guessing from base URLs', () => {
    expect(
      resolveImageModel(
        makeProvider({
          name: 'Internal gateway',
          providerFamily: 'openai',
          baseUrl: 'https://gateway.example.com/v1',
          model: '',
        }),
      ),
    ).toBe(PRIMARY_OPENAI_IMAGE_MODEL);
  });
});
