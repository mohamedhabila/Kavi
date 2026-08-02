const mockRunOrchestrator = jest.fn();
const mockCreateSubAgentOrchestratorCallbacks = jest.fn();

jest.mock('../../../src/engine/orchestrator', () => ({
  runOrchestrator: (...args: unknown[]) => mockRunOrchestrator(...args),
}));

jest.mock('../../../src/services/agents/subAgentOrchestratorCallbacks', () => ({
  createSubAgentOrchestratorCallbacks: (...args: unknown[]) =>
    mockCreateSubAgentOrchestratorCallbacks(...args),
}));

import type { PendingVerifiedProcedureObservation } from '../../../src/services/memory/verifiedProcedure/executionSession';
import { runSubAgentOrchestratorLoop } from '../../../src/services/agents/subAgentOrchestratorRun';

describe('runSubAgentOrchestratorLoop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateSubAgentOrchestratorCallbacks.mockImplementation((params: any) => {
      params.resolve();
      return { onDone: jest.fn() };
    });
  });

  it('preserves the structured orchestrator result and exact worker execution binding', async () => {
    const pending = {} as PendingVerifiedProcedureObservation;
    const result = {
      terminalDisposition: 'final_candidate' as const,
      pendingVerifiedProcedureObservation: pending,
    };
    mockRunOrchestrator.mockResolvedValue(result);

    const received = await runSubAgentOrchestratorLoop({
      provider: { id: 'provider-1' },
      model: 'model-1',
      sessionId: 'worker-session-1',
      usageConversationId: 'parent-thread-1',
      workspaceConversationId: 'workspace-1',
      systemPrompt: 'system',
      messages: [],
      disableTooling: false,
      subAgent: {},
      config: {},
      runtimeState: {},
      maxIterations: 5,
      maxToolResultPreviewChars: 320,
      runControl: {},
      abortController: new AbortController(),
      transcriptMessages: [],
      transcriptToolCalls: new Map(),
      trackToolCall: jest.fn(),
      persistSessionContextNow: jest.fn(),
      checkpointSessionContext: jest.fn(),
      markModelResponseObserved: jest.fn(),
      refreshSubAgentArtifacts: jest.fn(),
      appendTranscriptMessage: jest.fn(),
      appendActivity: jest.fn(),
      updateAgentProgress: jest.fn(),
      recordUsage: jest.fn(),
    } as any);

    expect(received).toBe(result);
    expect(mockRunOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'worker-session-1',
        memoryConversationId: 'worker-session-1',
        executionRunId: 'worker-session-1',
      }),
      expect.objectContaining({ onDone: expect.any(Function) }),
    );
    expect(mockRunOrchestrator.mock.calls[0][0]).not.toHaveProperty('maxToolIterations');
  });

  it('keeps explicit code-owned worker limits fixed instead of enabling adaptive defaults', async () => {
    mockRunOrchestrator.mockResolvedValue({ terminalDisposition: 'final_candidate' });

    await runSubAgentOrchestratorLoop({
      provider: { id: 'provider-1' },
      model: 'model-1',
      sessionId: 'worker-session-explicit-budget',
      usageConversationId: 'parent-thread-1',
      workspaceConversationId: 'workspace-1',
      systemPrompt: 'system',
      messages: [],
      disableTooling: false,
      subAgent: {},
      config: { maxIterations: 64 },
      runtimeState: {},
      maxIterations: 64,
      maxToolResultPreviewChars: 320,
      runControl: {},
      abortController: new AbortController(),
      transcriptMessages: [],
      transcriptToolCalls: new Map(),
      trackToolCall: jest.fn(),
      persistSessionContextNow: jest.fn(),
      checkpointSessionContext: jest.fn(),
      markModelResponseObserved: jest.fn(),
      refreshSubAgentArtifacts: jest.fn(),
      appendTranscriptMessage: jest.fn(),
      appendActivity: jest.fn(),
      updateAgentProgress: jest.fn(),
      recordUsage: jest.fn(),
    } as any);

    expect(mockRunOrchestrator.mock.calls[0][0]).toMatchObject({ maxToolIterations: 129 });
  });

  it('settles promptly when cancellation aborts an otherwise unresolved orchestrator', async () => {
    mockCreateSubAgentOrchestratorCallbacks.mockImplementation(() => ({}));
    mockRunOrchestrator.mockImplementation(() => new Promise(() => undefined));
    const abortController = new AbortController();

    const pending = runSubAgentOrchestratorLoop({
      provider: { id: 'provider-1' },
      model: 'model-1',
      sessionId: 'worker-session-cancelled',
      usageConversationId: 'parent-thread-1',
      workspaceConversationId: 'workspace-1',
      systemPrompt: 'system',
      messages: [],
      disableTooling: false,
      subAgent: {},
      config: {},
      runtimeState: {},
      maxIterations: 32,
      maxToolResultPreviewChars: 320,
      runControl: { abortReason: 'cancelled' },
      abortController,
      transcriptMessages: [],
      transcriptToolCalls: new Map(),
      trackToolCall: jest.fn(),
      persistSessionContextNow: jest.fn(),
      checkpointSessionContext: jest.fn(),
      markModelResponseObserved: jest.fn(),
      refreshSubAgentArtifacts: jest.fn(),
      appendTranscriptMessage: jest.fn(),
      appendActivity: jest.fn(),
      updateAgentProgress: jest.fn(),
      recordUsage: jest.fn(),
    } as any);

    abortController.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
