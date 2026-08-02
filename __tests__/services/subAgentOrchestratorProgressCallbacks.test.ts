import { createSubAgentOrchestratorProgressCallbacks } from '../../src/services/agents/subAgentOrchestratorProgressCallbacks';

describe('sub-agent orchestrator progress callbacks', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records a new model-response wait even when prior assistant text remains visible', () => {
    const now = 1_785_582_900_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const subAgent = {} as any;
    const updateAgentProgress = jest.fn();
    const callbacks = createSubAgentOrchestratorProgressCallbacks({
      abortController: new AbortController(),
      config: {} as any,
      providerId: 'provider',
      sessionId: 'session',
      subAgent,
      runtimeState: {
        outputText: 'Previously streamed assistant text remains visible.',
        lastNonEmptyContent: '',
        finalNonEmptyContent: '',
        lastSubstantiveToolResult: '',
        iterations: 4,
        lastTokenHeartbeatAt: 0,
        lastTaskLedgerSignature: '',
        toolsUsed: ['read_file'],
        toolResultPreviews: [],
      },
      maxIterations: 32,
      maxToolResultPreviewChars: 320,
      runControl: {},
      transcriptMessages: [],
      transcriptToolCalls: new Map(),
      trackToolCall: jest.fn(),
      persistSessionContextNow: jest.fn(),
      checkpointSessionContext: jest.fn(),
      markModelResponseObserved: jest.fn(),
      refreshSubAgentArtifacts: jest.fn(),
      appendTranscriptMessage: jest.fn(),
      appendActivity: jest.fn(),
      updateAgentProgress,
      recordUsage: jest.fn(),
      reject: jest.fn(),
      resolve: jest.fn(),
    } as any);

    callbacks.onStateChange?.('responding');

    expect(updateAgentProgress).toHaveBeenCalledTimes(1);
    expect(updateAgentProgress.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        currentActivity: 'Previously streamed assistant text remains visible.',
        launchState: 'active',
        modelResponsePendingSince: now,
      }),
    );
  });
});
