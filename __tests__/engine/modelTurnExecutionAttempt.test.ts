import { executeAgentControlGraphModelTurnAttempt } from '../../src/engine/graph/modelTurnExecutionAttempt';
import { finalizeProviderConfig } from '../../src/constants/api';

async function* unsignedToolTurnStream() {
  yield {
    type: 'tool_call' as const,
    toolCall: {
      id: 'tc1',
      name: 'read_file',
      arguments: '{"path":"test.txt"}',
    },
  };
  yield { type: 'done' as const, content: '' };
}

async function* usageOnlyTurnStream() {
  yield { type: 'token' as const, content: 'Done.' };
  yield {
    type: 'usage' as const,
    usage: {
      inputTokens: 1600,
      outputTokens: 20,
      cacheReadTokens: 512,
      cacheWriteTokens: 0,
      totalTokens: 1620,
    },
  };
  yield { type: 'done' as const, content: 'Done.' };
}

describe('executeAgentControlGraphModelTurnAttempt replay retries', () => {
  it('reports structural token buckets and prompt-cache telemetry with model usage', async () => {
    const streamMessage = jest.fn().mockImplementation(() => usageOnlyTurnStream());
    const reportUsage = jest.fn();

    const result = await executeAgentControlGraphModelTurnAttempt({
      activeProvider: finalizeProviderConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        model: 'gpt-5.4',
        enabled: true,
      }),
      applyGraphEvents: jest.fn(),
      callbacks: {
        onStateChange: jest.fn(),
        onToken: jest.fn(),
        onAssistantStreamReset: jest.fn(),
      },
      compactionEngine: null,
      conversationId: 'conv-usage-telemetry',
      effectiveForceTextReasonThisTurn: undefined,
      hasPendingAsyncOperations: false,
      iteration: 1,
      livingMemory: {
        cacheableSignature: 'cacheable-signature',
        cacheableProfileSections: [{ title: 'Profile', content: 'Stable profile facts.' }],
        dynamicContext: 'Recent memory context.',
      },
      llm: { streamMessage, sendMessage: jest.fn() },
      onCompaction: undefined,
      preparedTurn: {
        enrichedSystemPrompt: 'System guidance. '.repeat(1400),
        enrichedSystemPromptSections: [{ text: 'System guidance.', cacheable: true }],
        pinnedToolNames: [],
        selectedToolTokenEstimate: 0,
        selectedTools: [{ name: 'read_file', description: 'read', parameters: {} }],
        toolsForIteration: [{ name: 'read_file', description: 'read', parameters: {} }],
      },
      recordPerformanceMetrics: jest.fn(),
      reportUsage,
      requestMaxTokens: 1024,
      requestModel: 'gpt-5.4',
      signal: undefined,
      temperature: 1,
      thinkingLevel: 'off',
      warn: jest.fn(),
      workingMessages: [
        { id: 'u1', role: 'user', content: 'Summarize the latest state.', timestamp: Date.now() },
      ],
      yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
    });

    expect(result.kind).toBe('success');
    expect(reportUsage).toHaveBeenCalledTimes(1);
    expect(reportUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 1600,
        outputTokens: 20,
        cacheReadTokens: 512,
        tokenBuckets: expect.objectContaining({
          systemPromptTokens: expect.any(Number),
          toolDeclarationTokens: expect.any(Number),
          memoryContextTokens: expect.any(Number),
          conversationHistoryTokens: expect.any(Number),
          userTurnTokens: expect.any(Number),
          toolResultTokens: expect.any(Number),
        }),
        promptCache: expect.objectContaining({
          eligible: true,
          enabled: true,
          providerFamily: 'openai',
          hostedFamily: 'openai',
          mode: 'openai_native',
          event: 'provider_managed',
          reason: 'automatic_prompt_cache',
          explicitCacheName: expect.stringMatching(/^cm:/),
        }),
      }),
    );
    const [, streamOptions] = streamMessage.mock.calls[0]!;
    expect(streamOptions.usageTelemetry.promptCache).toMatchObject({
      mode: 'openai_native',
      event: 'provider_managed',
    });
  });

  it('falls back to stream when non-stream reconcile returns no covered tool calls', async () => {
    const streamMessage = jest.fn().mockImplementation(() => unsignedToolTurnStream());
    const sendMessage = jest.fn().mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '' } }],
    });

    await expect(
      executeAgentControlGraphModelTurnAttempt({
        activeProvider: finalizeProviderConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'test-key',
          model: 'gemini-3-flash-preview',
          enabled: true,
        }),
        applyGraphEvents: jest.fn(),
        callbacks: {
          onStateChange: jest.fn(),
          onToken: jest.fn(),
          onAssistantStreamReset: jest.fn(),
        },
        compactionEngine: null,
        conversationId: 'conv-1',
        effectiveForceTextReasonThisTurn: undefined,
        hasPendingAsyncOperations: false,
        iteration: 1,
        livingMemory: undefined,
        llm: { streamMessage, sendMessage },
        onCompaction: undefined,
        preparedTurn: {
          enrichedSystemPrompt: 'system',
          enrichedSystemPromptSections: [],
          pinnedToolNames: [],
          selectedToolTokenEstimate: 0,
          selectedTools: [{ name: 'read_file', description: 'read', parameters: {} }],
          toolsForIteration: [{ name: 'read_file', description: 'read', parameters: {} }],
        },
        recordPerformanceMetrics: jest.fn(),
        reportUsage: jest.fn(),
        requestMaxTokens: 1024,
        requestModel: 'gemini-3-flash-preview',
        signal: undefined,
        temperature: 1,
        thinkingLevel: 'off',
        warn: jest.fn(),
        workingMessages: [
          { id: 'u1', role: 'user', content: 'Read file', timestamp: Date.now() },
        ],
        yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow('missing required provider replay coverage after retries');

    expect(streamMessage).toHaveBeenCalledTimes(5);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
