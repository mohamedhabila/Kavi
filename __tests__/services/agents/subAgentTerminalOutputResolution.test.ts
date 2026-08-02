import { resolveSubAgentRunOutput } from '../../../src/services/agents/lifecycle/terminalOutputResolution';
import { synthesizeSubAgentFinalAnswer } from '../../../src/services/agents/subAgentFinalization';
import type { LlmProviderConfig } from '../../../src/types/provider';

jest.mock('../../../src/services/agents/subAgentFinalization', () => ({
  synthesizeSubAgentFinalAnswer: jest.fn(),
}));

const mockSynthesizeSubAgentFinalAnswer = jest.mocked(synthesizeSubAgentFinalAnswer);

const provider: LlmProviderConfig = {
  id: 'provider-1',
  name: 'Provider',
  kind: 'remote',
  baseUrl: 'https://example.test/v1',
  apiKey: '',
  model: 'model-1',
  enabled: true,
};

function baseParams() {
  return {
    status: 'completed' as const,
    provider,
    model: provider.model,
    systemPrompt: 'Worker system prompt',
    currentTaskPrompt: 'Read the supplied file and return an exact JSON object.',
    outputText: '',
    lastNonEmptyContent: '',
    finalNonEmptyContent: '{"findings":["verified"]}',
    lastSubstantiveToolResult: '',
    toolsUsed: ['read_file'],
    toolResultPreviews: [
      {
        toolName: 'read_file',
        preview: '{"status":"read_chunk","complete":true}',
        status: 'completed' as const,
      },
    ],
    transcriptMessages: [],
    iterations: 1,
    startedAt: Date.now(),
    timeoutMs: 60_000,
    outputTruncation: 20_000,
    requireStructuredExecutionEvidence: true,
    maxToolResultPreviewChars: 1_000,
    finalizationMaxTranscriptMessages: 12,
    finalizationMessageCharLimit: 1_800,
    finalizationToolContentCharLimit: 2_600,
    finalizationMinRemainingMs: 1_000,
    finalizationTimeoutCapMs: 10_000,
    reportUsage: jest.fn(),
    onFinalizationStart: jest.fn(),
    onFinalizedOutput: jest.fn(),
  };
}

describe('resolveSubAgentRunOutput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves an exact worker deliverable while classifying its verified read evidence', async () => {
    mockSynthesizeSubAgentFinalAnswer.mockResolvedValue({
      report: 'The source-grounded review is complete.',
      completionState: 'verified_success',
    });
    const params = baseParams();

    const result = await resolveSubAgentRunOutput(params);

    expect(result).toEqual({
      output: params.finalNonEmptyContent,
      completionState: 'verified_success',
    });
    expect(params.onFinalizationStart).toHaveBeenCalledTimes(1);
    expect(params.onFinalizedOutput).not.toHaveBeenCalled();
  });

  it('does not override an explicit incomplete worker state', async () => {
    const params = {
      ...baseParams(),
      finalNonEmptyContent: 'Partial findings.\ncompletion_state: incomplete',
    };

    const result = await resolveSubAgentRunOutput(params);

    expect(result).toEqual({ output: 'Partial findings.', completionState: 'incomplete' });
    expect(mockSynthesizeSubAgentFinalAnswer).not.toHaveBeenCalled();
  });

  it('fails closed when the only worker tool result failed', async () => {
    mockSynthesizeSubAgentFinalAnswer.mockResolvedValue({
      report: 'The review is complete.',
      completionState: 'verified_success',
    });
    const params = baseParams();
    params.toolResultPreviews[0].status = 'failed';

    const result = await resolveSubAgentRunOutput(params);

    expect(result).toEqual({
      output: params.finalNonEmptyContent,
      completionState: 'blocked',
    });
  });
});
