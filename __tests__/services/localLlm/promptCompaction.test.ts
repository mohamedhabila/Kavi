import { buildLocalPrompt } from '../../../src/services/localLlm/plainPrompt';
import { buildStructuredLocalConversation } from '../../../src/services/localLlm/structuredConversation';
import type {
  LocalChatMessage,
  LocalLlmExecutionPolicy,
} from '../../../src/services/localLlm/types';
import type { ToolDefinition } from '../../../src/types/tool';

function createExecutionPolicy(
  overrides?: Partial<LocalLlmExecutionPolicy>,
): LocalLlmExecutionPolicy {
  return {
    modelId: 'gemma-4-E2B-it',
    modelName: 'Gemma 4 E2B',
    runtime: 'litert-lm',
    maxTokens: 1024,
    recommendedMaxTokens: 1024,
    maxContextLength: 32000,
    safeMaxContextWindowTokens: 4096,
    topK: 64,
    topP: 0.95,
    temperature: 1,
    minDeviceMemoryGb: 8,
    ...overrides,
  };
}

describe('local on-device prompt compaction', () => {
  it('keeps only the most recent plain-text history turns on tight local budgets', () => {
    const messages: LocalChatMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'user-1' },
      { role: 'assistant', content: 'assistant-1' },
      { role: 'user', content: 'user-2' },
      { role: 'assistant', content: 'assistant-2' },
      { role: 'user', content: 'user-3' },
      { role: 'assistant', content: 'assistant-3' },
      { role: 'user', content: 'final-user' },
    ];

    const prompt = buildLocalPrompt(messages, createExecutionPolicy());

    expect(prompt.prompt).toBe('final-user');
    expect(prompt.history).toEqual([
      { role: 'user', content: 'user-3' },
      { role: 'assistant', content: 'assistant-3' },
    ]);
    expect(prompt.context.compactionState).toBe('history_windowed');
  });

  it('keeps only the most recent structured groups on tight local budgets', () => {
    const messages: LocalChatMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'user-1' },
      { role: 'assistant', content: 'assistant-1' },
      { role: 'user', content: 'user-2' },
      { role: 'assistant', content: 'assistant-2' },
      { role: 'user', content: 'final-user' },
    ];

    const conversation = buildStructuredLocalConversation(
      messages,
      createExecutionPolicy(),
      undefined,
    );

    expect(conversation.currentMessage).toEqual({
      role: 'user',
      content: 'final-user',
    });
    expect(conversation.history).toEqual([
      {
        role: 'assistant',
        content: 'assistant-2',
      },
    ]);
    expect(conversation.context.compactionState).toBe('history_windowed');
  });

  it('surfaces oversized active user content without trimming the task', () => {
    const oversizedPrompt = `${'critical-context '.repeat(1_500)}final-required-detail`;

    expect(() =>
      buildLocalPrompt(
        [{ role: 'user', content: oversizedPrompt }],
        createExecutionPolicy({ safeMaxContextWindowTokens: 2048 }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'LOCAL_LLM_CONTEXT_PRESSURE',
        reason: 'current_message_exceeds_budget',
      }),
    );
  });

  it('surfaces oversized structured tools instead of silently dropping them', () => {
    const tools: ToolDefinition[] = Array.from({ length: 8 }, (_, index) => ({
      name: `tool_${index}`,
      description: `Capability ${index}. ${'Detailed structured capability description. '.repeat(
        80,
      )}`,
      input_schema: {
        type: 'object',
        properties: Object.fromEntries(
          Array.from({ length: 10 }, (_unused, propertyIndex) => [
            `field_${propertyIndex}`,
            {
              type: 'string',
              description: 'Long schema detail. '.repeat(40),
            },
          ]),
        ),
      },
    }));

    expect(() =>
      buildStructuredLocalConversation(
        [{ role: 'user', content: 'Use the available capability if it is needed.' }],
        createExecutionPolicy({ safeMaxContextWindowTokens: 4096 }),
        tools,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'LOCAL_LLM_CONTEXT_PRESSURE',
        reason: 'tool_payload_exceeds_budget',
      }),
    );
  });
});
