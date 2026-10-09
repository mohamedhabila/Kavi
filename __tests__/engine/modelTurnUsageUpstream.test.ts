jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { executeAgentControlGraphModelTurnViaSendMessage } from '../../src/engine/graph/modelTurnExecutionSendMessage';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';

describe('non-streaming usage', () => {
  it('counts cached tokens an OpenAI-shaped non-streaming response reports', async () => {
    // Regression: this path read only Anthropic's `cache_read_input_tokens`, so every
    // OpenAI-shaped response reported zero cache reads.
    const reportUsage = jest.fn();

    await executeAgentControlGraphModelTurnViaSendMessage({
      applyGraphEvents: jest.fn(),
      budgetTools: [],
      callbacks: { onStateChange: jest.fn(), onToken: jest.fn() },
      geminiNative: true,
      iteration: 1,
      llm: {
        sendMessage: jest.fn(async () => ({
          choices: [{ message: { content: 'Done' }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 3000,
            completion_tokens: 10,
            total_tokens: 3010,
            prompt_tokens_details: { cached_tokens: 2048 },
          },
        })),
      },
      memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      recordPerformanceMetrics: jest.fn(),
      reportUsage,
      requestMessages: [{ role: 'user', content: 'Continue' }],
      requestModel: 'gemini-3-flash-preview',
      signal: undefined,
      streamOptions: {},
    } as never);

    expect(reportUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 3000, outputTokens: 10, cacheReadTokens: 2048 }),
    );
  });
});
