import {
  assertProviderReadyForRequest,
  resolveConversationModel,
  resolveConversationStartSelection,
} from '../../../src/services/llm/providerSupport';

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
        name: 'Gemma (on-device)',
        kind: 'on-device',
        local: { runtime: 'mediapipe-genai' },
        apiKey: '',
      } as any),
    ).not.toThrow();
  });
});
