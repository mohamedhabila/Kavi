import {
  buildUsageLogDetail,
  extractResponseTokenUsage,
  recordImageToolConversationUsage,
  recordConversationUsageEvent,
} from '../../src/services/usage/conversationUsage';
import { clearUsageData, getSessionUsage } from '../../src/services/usage/tracker';
import { useChatStore } from '../../src/store/useChatStore';

beforeEach(() => {
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    isLoading: false,
  });
  clearUsageData();
  jest.restoreAllMocks();
});

describe('conversationUsage', () => {
  it('formats usage log details with source and cache information', () => {
    const detail = buildUsageLogDetail(
      {
        model: 'gpt-5.4',
        inputTokens: 1200,
        outputTokens: 45,
        cacheReadTokens: 900,
        cacheWriteTokens: 50,
      },
      0.0099,
      'sub-agent',
    );

    expect(detail).toContain('Sub-agent');
    expect(detail).toContain('gpt-5.4');
    expect(detail).toContain('in 1,200');
    expect(detail).toContain('out 45');
    expect(detail).toContain('cost $0.0099');
    expect(detail).toContain('cache 900 / 1,200');
    expect(detail).toContain('write 50');
  });

  it('formats image usage log details with modality metadata', () => {
    const detail = buildUsageLogDetail(
      {
        model: 'gpt-image-2',
        inputTokens: 320,
        outputTokens: 960,
        tokenDetails: {
          inputImageTokens: 200,
          outputImageTokens: 960,
          outputThinkingTokens: 12,
        },
      },
      0.032,
      'primary',
    );

    expect(detail).toContain('gpt-image-2');
    expect(detail).toContain('img in 200');
    expect(detail).toContain('img out 960');
    expect(detail).toContain('thinking 12');
  });

  it('extracts normalized token usage from model responses', () => {
    const usage = extractResponseTokenUsage(
      {
        usage: {
          prompt_tokens: 320,
          completion_tokens: 40,
          total_tokens: 360,
          prompt_tokens_details: {
            cached_tokens: 200,
            cache_write_tokens: 60,
          },
        },
      },
      'gpt-5.4',
    );

    expect(usage).toEqual({
      model: 'gpt-5.4',
      inputTokens: 320,
      outputTokens: 40,
      cacheReadTokens: 200,
      cacheWriteTokens: 60,
      totalTokens: 360,
    });
  });

  it('records conversation usage, session totals, and usage logs', () => {
    const conversationId = useChatStore.getState().createConversation('openai', 'system');

    recordConversationUsageEvent({
      conversationId,
      providerId: 'openai',
      source: 'pilot',
      sessionId: 'worker-123',
      parentSessionId: 'parent-456',
      agentRunId: 'run-789',
      estimatedCost: 0.0042,
      timestamp: 1700000000000,
      recordSessionUsage: true,
      emitLog: true,
      usage: {
        model: 'gpt-5.4',
        inputTokens: 120,
        outputTokens: 45,
        cacheReadTokens: 20,
        cacheWriteTokens: 5,
        totalTokens: 180,
        tokenBuckets: {
          systemPromptTokens: 10,
          toolDeclarationTokens: 20,
          memoryContextTokens: 30,
          conversationHistoryTokens: 40,
          userTurnTokens: 50,
          toolResultTokens: 60,
        },
        promptCache: {
          eligible: true,
          enabled: true,
          estimatedInputTokens: 1200,
          thresholdTokens: 1024,
          providerFamily: 'openai',
          hostedFamily: 'openai',
          mode: 'openai_native',
          event: 'provider_managed',
          reason: 'automatic_prompt_cache',
          explicitCacheName: 'cm:test',
        },
      },
    });

    const conversation = useChatStore
      .getState()
      .conversations.find((item) => item.id === conversationId);
    const sessionUsage = getSessionUsage(conversationId);

    expect(conversation?.usage).toEqual(
      expect.objectContaining({
        totalInput: 120,
        totalOutput: 45,
        totalCacheRead: 20,
        totalCacheWrite: 5,
        totalTokens: 180,
        totalCost: 0.0042,
        totalCalls: 1,
        lastModel: 'gpt-5.4',
        lastProviderId: 'openai',
        lastUpdatedAt: 1700000000000,
      }),
    );
    expect(conversation?.usage?.entries[0]).toEqual(
      expect.objectContaining({
        providerId: 'openai',
        source: 'pilot',
        sessionId: 'worker-123',
        parentSessionId: 'parent-456',
        agentRunId: 'run-789',
        totalTokens: 180,
        estimatedCost: 0.0042,
        tokenBuckets: {
          systemPromptTokens: 10,
          toolDeclarationTokens: 20,
          memoryContextTokens: 30,
          conversationHistoryTokens: 40,
          userTurnTokens: 50,
          toolResultTokens: 60,
        },
        promptCache: {
          eligible: true,
          enabled: true,
          estimatedInputTokens: 1200,
          thresholdTokens: 1024,
          providerFamily: 'openai',
          hostedFamily: 'openai',
          mode: 'openai_native',
          event: 'provider_managed',
          reason: 'automatic_prompt_cache',
          explicitCacheName: 'cm:test',
        },
      }),
    );
    expect(conversation?.logs?.[0]).toEqual(
      expect.objectContaining({
        kind: 'usage',
        title: 'Usage recorded',
        timestamp: 1700000000000,
      }),
    );
    expect(conversation?.logs?.[0]?.detail).toContain('Pilot');
    expect(sessionUsage).toEqual(
      expect.objectContaining({
        totalInput: 120,
        totalOutput: 45,
      }),
    );
    expect(sessionUsage?.entries[0]).toEqual(
      expect.objectContaining({
        tokenBuckets: {
          systemPromptTokens: 10,
          toolDeclarationTokens: 20,
          memoryContextTokens: 30,
          conversationHistoryTokens: 40,
          userTurnTokens: 50,
          toolResultTokens: 60,
        },
        promptCache: expect.objectContaining({
          eligible: true,
          mode: 'openai_native',
          event: 'provider_managed',
          explicitCacheName: 'cm:test',
        }),
      }),
    );
  });

  it('forces on-device conversation usage cost to zero even when a caller passes an estimate', () => {
    const conversationId = useChatStore.getState().createConversation('gemma-local', 'system');

    recordConversationUsageEvent({
      conversationId,
      providerId: 'gemma-local',
      estimatedCost: 0.1234,
      emitLog: true,
      usage: {
        model: 'gemma-4-E2B-it',
        inputTokens: 120,
        outputTokens: 45,
        totalTokens: 165,
      },
    });

    const conversation = useChatStore
      .getState()
      .conversations.find((item) => item.id === conversationId);
    expect(conversation?.usage?.totalCost).toBe(0);
    expect(conversation?.usage?.entries[0]?.estimatedCost).toBe(0);
    expect(conversation?.logs?.[0]?.detail).toContain('cost $0.0000');
  });

  it('records image tool usage on the conversation ledger exactly once', () => {
    const conversationId = useChatStore.getState().createConversation('openai', 'system');

    const toolCall = {
      id: 'tool-image-1',
      name: 'image_generate' as const,
      status: 'completed' as const,
      completedAt: 1700000000005,
      result: JSON.stringify({
        status: 'generated',
        providerId: 'openai',
        model: 'gpt-image-2',
        mimeType: 'image/png',
        fileUri: 'file:///mock/document/workspace/conv-1/generated.png',
        fileName: 'generated.png',
        size: 1024,
        usage: {
          model: 'gpt-image-2',
          inputTokens: 320,
          outputTokens: 960,
          totalTokens: 1280,
          tokenDetails: {
            inputTextTokens: 120,
            inputImageTokens: 200,
            outputImageTokens: 960,
          },
        },
      }),
    };

    recordImageToolConversationUsage({
      conversationId,
      providerId: 'openai',
      source: 'primary',
      emitLog: true,
      toolCall,
    });

    recordImageToolConversationUsage({
      conversationId,
      providerId: 'openai',
      source: 'primary',
      emitLog: true,
      toolCall,
    });

    const conversation = useChatStore
      .getState()
      .conversations.find((item) => item.id === conversationId);
    expect(conversation?.usage).toEqual(
      expect.objectContaining({
        totalInput: 320,
        totalOutput: 960,
        totalTokens: 1280,
        totalCalls: 1,
        lastModel: 'gpt-image-2',
        lastProviderId: 'openai',
      }),
    );
    expect(conversation?.usage?.entries[0]).toEqual(
      expect.objectContaining({
        modality: 'image',
        toolCallId: 'tool-image-1',
        tokenDetails: expect.objectContaining({
          inputImageTokens: 200,
          outputImageTokens: 960,
        }),
      }),
    );
    expect(conversation?.logs).toHaveLength(1);
    expect(conversation?.logs?.[0]?.detail).toContain('img out 960');
  });

  it('tolerates store states that do not expose usage methods', () => {
    const getStateSpy = jest
      .spyOn(useChatStore, 'getState')
      .mockReturnValue({} as ReturnType<typeof useChatStore.getState>);

    expect(() =>
      recordConversationUsageEvent({
        conversationId: 'conv-1',
        usage: {
          model: 'gpt-5.4',
          inputTokens: 10,
          outputTokens: 5,
        },
        emitLog: true,
      }),
    ).not.toThrow();

    getStateSpy.mockRestore();
  });
});
