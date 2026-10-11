const mockSendMessage = jest.fn();
jest.mock('../../../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({ sendMessage: mockSendMessage })),
}));
jest.mock('../../../../src/services/llm/support/providerSupport', () => ({
  ...jest.requireActual('../../../../src/services/llm/support/providerSupport'),
  resolveProviderApiKey: jest.fn(async () => 'test-key'),
}));

import { resolveMemoryExtractionModel } from '../../../../src/services/memory/core/memoryExtractionModel';
import { useSettingsStore } from '../../../../src/store/useSettingsStore';
import { useChatStore } from '../../../helpers/chatStoreHarness';
import type { LlmProviderConfig } from '../../../../src/types/provider';

const provider: LlmProviderConfig = {
  id: 'openrouter',
  name: 'OpenRouter',
  enabled: true,
  kind: 'remote',
  protocol: 'openai-chat',
  providerFamily: 'openrouter',
  apiKey: '',
  model: 'z-ai/glm-5.3-flash',
  baseUrl: 'https://openrouter.ai/api/v1',
};

beforeEach(() => {
  mockSendMessage.mockReset();
  useSettingsStore.setState({
    providers: [provider],
    activeProviderId: provider.id,
    activeModel: provider.model,
    disableLongTermMemory: false,
    memoryConsolidationMode: 'active_provider',
    consolidationProvider: null,
  });
});

describe('memory extraction model', () => {
  it('records each call in the conversation usage as memory, with its duration', async () => {
    const conversationId = useChatStore.getState().createConversation(provider.id, 'Be helpful.');
    mockSendMessage.mockResolvedValue({
      choices: [{ message: { content: '{"operations":[]}' } }],
      usage: { prompt_tokens: 420, completion_tokens: 12, total_tokens: 432 },
    });

    const call = await resolveMemoryExtractionModel();
    await expect(call!('extract', new AbortController().signal, conversationId)).resolves.toBe(
      '{"operations":[]}',
    );

    const usage = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === conversationId)!.usage!;
    expect(usage.entries).toEqual([
      expect.objectContaining({
        source: 'memory',
        providerId: provider.id,
        model: provider.model,
        inputTokens: 420,
        outputTokens: 12,
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it('records nothing when the provider reports no usage', async () => {
    const conversationId = useChatStore.getState().createConversation(provider.id, 'Be helpful.');
    mockSendMessage.mockResolvedValue({ choices: [{ message: { content: '{"operations":[]}' } }] });

    const call = await resolveMemoryExtractionModel();
    await call!('extract', new AbortController().signal, conversationId);

    expect(
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === conversationId)!.usage?.entries ??
        [],
    ).toEqual([]);
  });

  it('does not extract while memory is off or extraction is turned off', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true });
    await expect(resolveMemoryExtractionModel()).resolves.toBeNull();

    useSettingsStore.setState({ disableLongTermMemory: false, memoryConsolidationMode: 'off' });
    await expect(resolveMemoryExtractionModel()).resolves.toBeNull();
  });
});
