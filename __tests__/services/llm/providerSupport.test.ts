import {
  assertProviderReadyForRequest,
  resolveConversationModel,
  resolveConversationStartSelection,
} from '../../../src/services/llm/support/providerSupport';
import { finalizeProviderConfig } from '../../../src/constants/api';

describe('finalizeProviderConfig', () => {
  it('assigns explicit voyage provider family metadata', () => {
    const provider = finalizeProviderConfig({
      id: 'voyage',
      name: 'Research backend',
      baseUrl: 'https://api.voyageai.com/v1',
      apiKey: 'vk',
      model: 'voyage-3-lite',
      enabled: true,
    } as any);

    expect(provider.providerFamily).toBe('voyage');
  });

  it('assigns explicit mistral provider family metadata', () => {
    const provider = finalizeProviderConfig({
      id: 'mistral',
      name: 'Embeddings',
      baseUrl: 'https://api.mistral.ai/v1',
      apiKey: 'mk',
      model: 'mistral-large-3',
      enabled: true,
    } as any);

    expect(provider.providerFamily).toBe('mistral');
  });
});

describe('resolveConversationStartSelection', () => {
  it('uses the preferred model for the preferred provider', () => {
    const selection = resolveConversationStartSelection(
      [
        {
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com',
          model: 'gemini-3.1-pro-preview',
          enabled: true,
        } as any,
      ],
      'gemini',
      'gemini-3-flash-preview',
    );

    expect(selection).toMatchObject({
      providerId: 'gemini',
      model: 'gemini-3-flash-preview',
    });
  });

  it('falls back to the provider default when the preferred model is no longer supported', () => {
    const selection = resolveConversationStartSelection(
      [
        {
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com',
          model: 'gemini-3.1-pro-preview',
          availableModels: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
          enabled: true,
        } as any,
      ],
      'gemini',
      'retired-legacy-model',
    );

    expect(selection).toMatchObject({
      providerId: 'gemini',
      model: 'gemini-3.1-pro-preview',
    });
  });

  it('keeps a newer same-family preferred model when provider catalogs are stale', () => {
    const selection = resolveConversationStartSelection(
      [
        {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
          availableModels: ['gpt-5.4', 'gpt-5-mini'],
          enabled: true,
        } as any,
      ],
      'openai',
      'gpt-5.5',
    );

    expect(selection).toMatchObject({
      providerId: 'openai',
      model: 'gpt-5.5',
    });
  });
});

describe('resolveConversationModel', () => {
  it('prefers the per-conversation model override', () => {
    expect(
      resolveConversationModel(
        {
          id: 'gemini',
          model: 'gemini-3.1-pro-preview',
          availableModels: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
        },
        {
          conversationModel: 'gemini-3-flash-preview',
          activeProviderId: 'gemini',
          activeModel: 'gemini-2.5-flash',
        },
      ),
    ).toBe('gemini-3-flash-preview');
  });

  it('uses the active model when the provider matches and no override is stored', () => {
    expect(
      resolveConversationModel(
        {
          id: 'gemini',
          model: 'gemini-3.1-pro-preview',
          availableModels: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
        },
        {
          activeProviderId: 'gemini',
          activeModel: 'gemini-3-flash-preview',
        },
      ),
    ).toBe('gemini-3-flash-preview');
  });

  it('falls back to the provider default when the active model belongs to a different provider', () => {
    expect(
      resolveConversationModel(
        {
          id: 'openai',
          model: 'gpt-5.4',
          availableModels: ['gpt-5.4', 'gpt-5.4-mini'],
        },
        {
          activeProviderId: 'gemini',
          activeModel: 'gemini-3-flash-preview',
        },
      ),
    ).toBe('gpt-5.4');
  });

  it('falls back to the provider default when a stored conversation model is no longer supported', () => {
    expect(
      resolveConversationModel(
        {
          id: 'anthropic',
          model: 'claude-sonnet-4-6',
          availableModels: ['claude-sonnet-4-6', 'claude-haiku-4-5'],
        },
        {
          conversationModel: 'legacy-archived-model',
          activeProviderId: 'anthropic',
          activeModel: 'claude-haiku-4-5',
        },
      ),
    ).toBe('claude-sonnet-4-6');
  });

  it('keeps selected newer same-family models when the provider list is stale', () => {
    expect(
      resolveConversationModel(
        {
          id: 'gemini',
          name: 'Gemini',
          providerFamily: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-3.1-pro-preview',
          availableModels: ['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite'],
        },
        {
          activeProviderId: 'gemini',
          activeModel: 'gemini-3.5-flash',
        },
      ),
    ).toBe('gemini-3.5-flash');
  });

  it('uses explicit provider family metadata without rediscovering provider identity from names or URLs', () => {
    expect(
      resolveConversationModel(
        {
          id: 'internal-gateway',
          name: 'Internal gateway',
          providerFamily: 'gemini',
          baseUrl: 'https://gateway.example.com/v1',
          model: 'gemini-3.1-pro-preview',
          availableModels: ['gemini-3.1-pro-preview'],
        },
        {
          activeProviderId: 'internal-gateway',
          activeModel: 'gemini-3.5-flash',
        },
      ),
    ).toBe('gemini-3.5-flash');
  });

  it('accepts hidden models when restoring a conversation selection', () => {
    expect(
      resolveConversationModel(
        {
          id: 'openai',
          model: 'gpt-5.4',
          availableModels: ['gpt-5.4'],
          hiddenModels: ['gpt-5.4-mini'],
        },
        {
          conversationModel: 'gpt-5.4-mini',
          activeProviderId: 'openai',
          activeModel: 'gpt-5.4',
        },
      ),
    ).toBe('gpt-5.4-mini');
  });
});

describe('assertProviderReadyForRequest', () => {
  it('throws when a remote provider has no API key configured', () => {
    expect(() =>
      assertProviderReadyForRequest({
        name: 'Anthropic',
        apiKey: '',
      } as any),
    ).toThrow('Provider "Anthropic" has no API key configured.');
  });

  it('allows on-device providers without an API key', () => {
    expect(() =>
      assertProviderReadyForRequest({
        name: 'On-device models',
        kind: 'on-device',
        local: { runtime: 'litert-lm' },
        apiKey: '',
      } as any),
    ).not.toThrow();
  });
});
