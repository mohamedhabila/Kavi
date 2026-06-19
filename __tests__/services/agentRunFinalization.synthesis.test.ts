import type { AgentRunFinalizationEvidence } from '../../src/services/agents/lifecycle/finalizePhaseTypes';
import type { LlmProviderConfig } from '../../src/types/provider';

jest.mock('../../src/services/llm/LlmService', () => {
  return {
    LlmService: jest.fn().mockImplementation(() => ({
      streamMessage: jest.fn(),
    })),
  };
});

import { synthesizeAgentRunFinalAnswer } from '../../src/services/agents/lifecycle/finalizePhase';
import { LlmService } from '../../src/services/llm/LlmService';

const mockStreamMessage = jest.fn();

(LlmService as any).mockImplementation(() => ({
  streamMessage: mockStreamMessage,
}));

async function* createStreamGenerator(events: any[]) {
  for (const event of events) {
    yield event;
  }
}

function makeProvider(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-5.4',
    enabled: true,
    ...overrides,
  };
}

function makeEvidence(): AgentRunFinalizationEvidence {
  return {
    originalPrompt: 'Audit the repository and summarize the outcome.',
    transcriptMessages: [
      {
        id: 'user-1',
        role: 'user',
        content: 'Audit the repository and summarize the outcome.',
        timestamp: 1,
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: 'Verified the patch and targeted tests passed.',
        timestamp: 2,
      },
    ],
    lastNonEmptyAssistantContent: '',
    lastSubstantiveResult: 'Verified the patch and targeted tests passed.',
    resultPreviews: [
      {
        sourceName: 'run_tests',
        preview: 'Verified the patch and targeted tests passed.',
      },
    ],
    toolsUsed: ['run_tests'],
    iterations: 1,
    hasIncompleteToolCalls: false,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStreamMessage.mockReset();
  (LlmService as any).mockImplementation(() => ({
    streamMessage: mockStreamMessage,
  }));
});

describe('agentRunFinalization synthesis', () => {
  it('continues incomplete synthesized final text until the answer completes', async () => {
    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator([
        { type: 'token', content: 'Partial summary' },
        {
          type: 'done',
          content: 'Partial summary',
          completion: { completionStatus: 'incomplete', finishReason: 'max_output_tokens' },
        },
      ]),
    );

    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator([
        { type: 'token', content: ' with the verified outcome.' },
        {
          type: 'done',
          content: ' with the verified outcome.',
          completion: { completionStatus: 'complete', finishReason: 'stop' },
          providerReplay: { openaiResponseOutput: [{ id: 'msg_1', type: 'message' }] },
        },
      ]),
    );

    const result = await synthesizeAgentRunFinalAnswer({
      provider: makeProvider(),
      model: 'gpt-5.4',
      systemPrompt: 'You are helpful.',
      evidence: makeEvidence(),
    });

    expect(mockStreamMessage).toHaveBeenCalledTimes(2);
    expect(mockStreamMessage.mock.calls[0][1].maxTokens).toBe(32000);
    expect(mockStreamMessage.mock.calls[1][1].maxTokens).toBe(32000);
    expect(mockStreamMessage.mock.calls[1][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: 'Partial summary' }),
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Continue the same final answer'),
        }),
      ]),
    );
    expect(result).toEqual({
      output: 'Partial summary with the verified outcome.',
      providerReplay: { openaiResponseOutput: [{ id: 'msg_1', type: 'message' }] },
    });
  });

  it('returns no synthesized output when the finalization pass remains incomplete after bounded retries', async () => {
    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator([
        { type: 'token', content: 'Partial summary' },
        {
          type: 'done',
          content: 'Partial summary',
          completion: { completionStatus: 'incomplete', finishReason: 'length' },
        },
      ]),
    );
    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator([
        { type: 'token', content: ' still incomplete' },
        {
          type: 'done',
          content: ' still incomplete',
          completion: { completionStatus: 'incomplete', finishReason: 'length' },
        },
      ]),
    );
    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator([
        { type: 'token', content: ' and truncated again' },
        {
          type: 'done',
          content: ' and truncated again',
          completion: { completionStatus: 'incomplete', finishReason: 'length' },
        },
      ]),
    );

    const result = await synthesizeAgentRunFinalAnswer({
      provider: makeProvider(),
      model: 'gpt-5.4',
      systemPrompt: 'You are helpful.',
      evidence: makeEvidence(),
    });

    expect(mockStreamMessage).toHaveBeenCalledTimes(3);
    expect(result).toEqual({});
  });
});
