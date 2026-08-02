import { createSubAgentOrchestratorToolCallbacks } from '../../src/services/agents/subAgentOrchestratorToolCallbacks';

function buildParams(config: { maxIterations?: number } = {}) {
  const abortController = new AbortController();
  const runControl: { abortReason?: 'cancelled' | 'timeout' | 'max-iterations' } = {};
  const runtimeState = {
    outputText: '',
    lastNonEmptyContent: '',
    finalNonEmptyContent: '',
    lastSubstantiveToolResult: '',
    iterations: 0,
    lastTokenHeartbeatAt: 0,
    lastTaskLedgerSignature: '',
    toolsUsed: [] as string[],
    toolResultPreviews: [],
  };
  const reject = jest.fn();
  const params = {
    abortController,
    config,
    providerId: 'provider-1',
    sessionId: 'worker-1',
    subAgent: {},
    runtimeState,
    maxIterations: 2,
    maxToolResultPreviewChars: 320,
    runControl,
    transcriptMessages: [],
    transcriptToolCalls: new Map(),
    trackToolCall: jest.fn((toolCall) => toolCall),
    persistSessionContextNow: jest.fn(),
    checkpointSessionContext: jest.fn(),
    markModelResponseObserved: jest.fn(),
    refreshSubAgentArtifacts: jest.fn(),
    appendTranscriptMessage: jest.fn(),
    appendActivity: jest.fn(),
    updateAgentProgress: jest.fn(),
    recordUsage: jest.fn(),
    reject,
    resolve: jest.fn(),
  } as any;

  return {
    abortController,
    callbacks: createSubAgentOrchestratorToolCallbacks(params),
    reject,
    runControl,
    runtimeState,
  };
}

describe('sub-agent orchestrator tool callbacks', () => {
  it('does not count parallel tool calls against the adaptive default horizon', () => {
    const { abortController, callbacks, reject, runControl, runtimeState } = buildParams();

    callbacks.onToolCallStart?.({ id: 'call-1', name: 'read_file' } as any);
    callbacks.onToolCallStart?.({ id: 'call-2', name: 'read_file' } as any);
    callbacks.onToolCallStart?.({ id: 'call-3', name: 'read_file' } as any);

    expect(runtimeState.iterations).toBe(3);
    expect(runControl.abortReason).toBeUndefined();
    expect(abortController.signal.aborted).toBe(false);
    expect(reject).not.toHaveBeenCalled();
  });

  it('terminalizes an explicitly capped worker as soon as its action limit is exceeded', () => {
    const { abortController, callbacks, reject, runControl, runtimeState } = buildParams({
      maxIterations: 2,
    });

    callbacks.onToolCallStart?.({ id: 'call-1', name: 'read_file' } as any);
    callbacks.onToolCallStart?.({ id: 'call-2', name: 'read_file' } as any);
    callbacks.onToolCallStart?.({ id: 'call-3', name: 'read_file' } as any);

    expect(runtimeState.iterations).toBe(3);
    expect(runControl.abortReason).toBe('max-iterations');
    expect(reject).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('maxIterations (2)') }),
    );
    expect(abortController.signal.aborted).toBe(true);
  });
});
