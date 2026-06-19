import { resolveForegroundRunPreflight } from '../../src/engine/graph/foregroundRun/preflight';
import type { Conversation } from '../../src/types/conversation';
import type { LlmProviderConfig } from '../../src/types/provider';

jest.mock('../../src/services/llm/support/providerSupport', () => ({
  bindProviderToModel: jest.fn((provider, model) => ({
    ...provider,
    ...(typeof model === 'string' && model.trim().length > 0 ? { model } : {}),
  })),
  providerRequiresApiKey: jest.fn(),
  resolveConversationModel: jest.fn(),
  resolveEnabledProvider: jest.fn(),
  resolveProviderApiKey: jest.fn(),
}));

const providerSupport = jest.requireMock('../../src/services/llm/support/providerSupport') as {
  bindProviderToModel: jest.Mock;
  providerRequiresApiKey: jest.Mock;
  resolveConversationModel: jest.Mock;
  resolveEnabledProvider: jest.Mock;
  resolveProviderApiKey: jest.Mock;
};

function createConversation(): Conversation {
  return {
    id: 'conv1',
    title: 'Test',
    mode: 'agentic',
    messages: [],
    providerId: 'provider-1',
    createdAt: 1,
    updatedAt: 1,
    usage: {
      entries: [],
      totalInput: 0,
      totalOutput: 0,
      totalCost: 0,
    },
  };
}

function createProvider(): LlmProviderConfig {
  return {
    id: 'provider-1',
    name: 'Gemini',
    enabled: true,
    kind: 'openai-compatible',
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-3.1-pro-preview',
    local: false,
  };
}

describe('foreground run preflight', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    providerSupport.bindProviderToModel.mockImplementation((provider, model) => ({
      ...provider,
      ...(typeof model === 'string' && model.trim().length > 0 ? { model } : {}),
    }));
  });

  it('returns missing_provider when no enabled provider is available', async () => {
    providerSupport.resolveEnabledProvider.mockReturnValue(undefined);

    await expect(
      resolveForegroundRunPreflight({
        activeModel: 'gemini-3.5-flash',
        activeProviderId: 'provider-1',
        conversation: createConversation(),
        conversationId: 'conv1',
        providers: [],
        systemPrompt: 'System prompt',
      }),
    ).resolves.toEqual({ kind: 'missing_provider' });
  });

  it('returns missing_api_key when the selected provider requires one and none is configured', async () => {
    const provider = createProvider();
    providerSupport.resolveEnabledProvider.mockReturnValue(provider);
    providerSupport.resolveProviderApiKey.mockResolvedValue('');
    providerSupport.providerRequiresApiKey.mockReturnValue(true);

    await expect(
      resolveForegroundRunPreflight({
        activeModel: 'gemini-3.5-flash',
        activeProviderId: 'provider-1',
        conversation: createConversation(),
        conversationId: 'conv1',
        providers: [provider],
        systemPrompt: 'System prompt',
      }),
    ).resolves.toEqual({ kind: 'missing_api_key' });
  });

  it('returns a hydrated provider context when the run is ready', async () => {
    const provider = createProvider();
    providerSupport.resolveEnabledProvider.mockReturnValue(provider);
    providerSupport.resolveProviderApiKey.mockResolvedValue('secret-key');
    providerSupport.providerRequiresApiKey.mockReturnValue(true);
    providerSupport.resolveConversationModel.mockReturnValue('gemini-3.5-flash');

    const result = await resolveForegroundRunPreflight({
      activeModel: 'gemini-3.5-flash',
      activeProviderId: 'provider-1',
      conversation: createConversation(),
      conversationId: 'conv1',
      options: {
        additionalUserPrompt: 'continue',
      },
      providers: [provider],
      systemPrompt: 'System prompt',
    });

    expect(result).toMatchObject({
      kind: 'ready',
      model: 'gemini-3.5-flash',
      provider: {
        ...provider,
        model: 'gemini-3.5-flash',
      },
      providerWithApiKey: {
        ...provider,
        apiKey: 'secret-key',
        model: 'gemini-3.5-flash',
      },
      finalizationProviderContext: {
        conversationId: 'conv1',
        internalUserMessageCount: 1,
        model: 'gemini-3.5-flash',
        provider: {
          ...provider,
          apiKey: 'secret-key',
          model: 'gemini-3.5-flash',
        },
        systemPromptText: 'System prompt',
      },
    });
  });
});
