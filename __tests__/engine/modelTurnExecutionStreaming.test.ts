import {
  executeAgentControlGraphModelTurnStreaming,
  executeAgentControlGraphModelTurnViaSendMessage,
} from '../../src/engine/graph/modelTurnExecutionStreaming';
import { hasGeminiToolTurnThoughtSignatureCoverage } from '../../src/services/llm/providers/gemini/thoughtSignatureCoverage';

async function* unsignedToolTurnStream() {
  yield {
    type: 'tool_call' as const,
    toolCall: {
      id: 'tc1',
      name: 'read_file',
      arguments: '{"path":"test.txt"}',
      raw: {
        id: 'tc1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"test.txt"}',
        },
      },
    },
  };
  yield { type: 'done' as const, content: '' };
}

async function* duplicateSyntheticToolIdStream() {
  yield {
    type: 'tool_call' as const,
    toolCall: {
      id: 'gemini-call-0',
      name: 'tool_catalog',
      arguments: '{"query":"agent"}',
      raw: {
        id: 'gemini-call-0',
        type: 'function',
        function: {
          name: 'tool_catalog',
          arguments: '{"query":"agent"}',
        },
      },
    },
  };
  yield {
    type: 'tool_call' as const,
    toolCall: {
      id: 'gemini-call-0',
      name: 'agents',
      arguments: '{"action":"list"}',
      raw: {
        id: 'gemini-call-0',
        type: 'function',
        function: {
          name: 'agents',
          arguments: '{"action":"list"}',
        },
      },
    },
  };
  yield { type: 'done' as const, content: '' };
}

describe('executeAgentControlGraphModelTurnStreaming', () => {
  it('queues unsigned Gemini tool calls when allowQueuedToolCalls is true', async () => {
    const onToolCallQueued = jest.fn();

    const result = await executeAgentControlGraphModelTurnStreaming({
      allowQueuedToolCalls: true,
      applyGraphEvents: jest.fn(),
      budgetTools: [{ name: 'read_file', description: 'read', parameters: {} }],
      callbacks: {
        onStateChange: jest.fn(),
        onToken: jest.fn(),
        onToolCallQueued,
      },
      iteration: 1,
      llm: {
        streamMessage: () => unsignedToolTurnStream(),
      },
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMessages: [{ role: 'user', content: 'Read file' }],
      requestModel: 'gemini-3-flash-preview',
      signal: undefined,
      streamOptions: { model: 'gemini-3-flash-preview', maxTokens: 256 },
    });

    expect(result.pendingToolCalls).toHaveLength(1);
    expect(result.pendingToolCalls[0]?.name).toBe('read_file');
    expect(onToolCallQueued).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct Gemini synthetic-id tool calls internally unique', async () => {
    const onToolCallQueued = jest.fn();

    const result = await executeAgentControlGraphModelTurnStreaming({
      allowQueuedToolCalls: true,
      applyGraphEvents: jest.fn(),
      budgetTools: [
        { name: 'tool_catalog', description: 'catalog', parameters: {} },
        { name: 'agents', description: 'agents', parameters: {} },
      ],
      callbacks: {
        onStateChange: jest.fn(),
        onToken: jest.fn(),
        onToolCallQueued,
      },
      iteration: 1,
      llm: {
        streamMessage: () => duplicateSyntheticToolIdStream(),
      },
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMessages: [{ role: 'user', content: 'Find agent tools' }],
      requestModel: 'gemini-3.5-flash',
      signal: undefined,
      streamOptions: { model: 'gemini-3.5-flash', maxTokens: 256 },
    });

    expect(result.pendingToolCalls.map((call) => call.id)).toEqual([
      'gemini-call-0',
      'gemini-call-0-1',
    ]);
    expect(result.pendingToolCalls.map((call) => call.name)).toEqual([
      'tool_catalog',
      'agents',
    ]);
    expect(onToolCallQueued).toHaveBeenCalledTimes(2);
    expect(onToolCallQueued.mock.calls.map(([call]) => call.id)).toEqual([
      'gemini-call-0',
      'gemini-call-0-1',
    ]);
  });
});

describe('executeAgentControlGraphModelTurnViaSendMessage', () => {
  it('maps generateContent tool calls with thought signatures for replay coverage', async () => {
    const callbacks = {
      onStateChange: jest.fn(),
      onToken: jest.fn(),
      onToolCallQueued: jest.fn(),
    };

    const result = await executeAgentControlGraphModelTurnViaSendMessage({
      applyGraphEvents: jest.fn(),
      budgetTools: [{ name: 'memory_recall', description: 'recall', parameters: {} }],
      callbacks,
      geminiNative: true,
      iteration: 2,
      llm: {
        sendMessage: jest.fn().mockResolvedValue({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: '',
                providerReplay: {
                  geminiParts: [
                    {
                      functionCall: {
                        name: 'memory_recall',
                        args: { subject: 'e2e-state-a' },
                      },
                      thoughtSignature: 'sig-non-stream',
                    },
                  ],
                },
                tool_calls: [
                  {
                    id: 'tc-1',
                    type: 'function',
                    function: {
                      name: 'memory_recall',
                      arguments: '{"subject":"e2e-state-a"}',
                    },
                    raw: {
                      id: 'tc-1',
                      type: 'function',
                      function: {
                        name: 'memory_recall',
                        arguments: '{"subject":"e2e-state-a"}',
                      },
                      thoughtSignature: 'sig-non-stream',
                      extra_content: { google: { thought_signature: 'sig-non-stream' } },
                    },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
      },
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMessages: [{ role: 'user', content: 'recall' }],
      requestModel: 'gemini-3.5-flash',
      signal: undefined,
      streamOptions: { model: 'gemini-3.5-flash', maxTokens: 256 },
    });

    expect(result.pendingToolCalls).toHaveLength(1);
    expect(result.pendingToolCalls[0]?.name).toBe('memory_recall');
    expect(
      hasGeminiToolTurnThoughtSignatureCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: result.pendingToolCalls,
        providerReplay: result.providerReplay,
      }),
    ).toBe(true);
    expect(callbacks.onToolCallQueued).toHaveBeenCalledTimes(1);
  });
});
