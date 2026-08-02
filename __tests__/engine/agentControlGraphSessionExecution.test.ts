import { executeAgentControlGraphIteration } from '../../src/engine/graph/iterationExecution';
import type { ExecuteAgentControlGraphSessionParams } from '../../src/engine/graph/sessionExecution';
import { buildGraphEntryRequestFrame } from '../../src/engine/graph/requestEntrySignals';
import { executeAgentControlGraphSession } from '../../src/engine/graph/sessionExecution';
import { emitSessionEvent } from '../../src/services/events/bus';
import { getMemoryPolicyEpoch } from '../../src/services/memory/policy';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { GRAPH_OBSERVABILITY_AUDIT_TYPES } from '../../src/engine/graph/graphObservability';

jest.mock('../../src/services/events/bus', () => ({
  emitSessionEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/engine/graph/iterationExecution', () => ({
  executeAgentControlGraphIteration: jest.fn(),
}));

const mockedEmitSessionEvent = jest.mocked(emitSessionEvent);
const mockedExecuteAgentControlGraphIteration = jest.mocked(executeAgentControlGraphIteration);

function createParams(
  overrides: Partial<ExecuteAgentControlGraphSessionParams> = {},
): ExecuteAgentControlGraphSessionParams {
  return {
    allProviders: [],
    allTools: [],
    callbacks: {
      onAssistantMessage: jest.fn(),
      onStateChange: jest.fn(),
      onToken: jest.fn(),
      onToolCallStart: jest.fn(),
      onToolCallComplete: jest.fn(),
      onToolMessage: jest.fn(),
    },
    compactionEngine: null,
    conversationId: 'conv-1',
    failoverState: null,
    graph: {
      applyAgentControlGraphEvents: jest.fn(),
      completedWorkflowToolNames: new Set<string>(),
      consumeOneShotTurnDirectives: jest.fn(),
      finishCancelled: jest.fn().mockResolvedValue(undefined),
      finishExistingTerminalSession: jest.fn().mockResolvedValue(undefined),
      finishFailure: jest.fn().mockResolvedValue(undefined),
      finishWithGraphFinalCandidateEvent: jest.fn().mockResolvedValue(undefined),
      finishWithGraphTerminalEvent: jest.fn().mockResolvedValue(undefined),
      getCurrentTurnDirectives: jest.fn().mockReturnValue({}),
      getGraphSnapshot: jest.fn().mockReturnValue(undefined),
      publishWorkflowToolResultProgressToAgentControlGraph: jest.fn(),
      recordPerformanceMetrics: jest.fn(),
      recordObservability: jest.fn(),
      recordPostToolFinalTextDirective: jest.fn().mockReturnValue(false),
      recordTurnDirectives: jest.fn(),
      resetIncompleteFinalTextRecovery: jest.fn(),
      syncPendingAsyncOperationsToGraph: jest.fn(),
    },
    initialRuntime: {
      activeModel: 'gpt-5-mini',
      activeProvider: { id: 'provider-1', name: 'OpenAI', enabled: true } as any,
      admittedMemoryContext: {
        admission: 'degraded',
        authoritySnapshot: null,
        consistencyBarrier: {
          outcome: 'degraded',
          durationMs: 0,
          waitedMs: 0,
          queryCount: 0,
          matchedJobCount: 0,
          queueAgeMs: null,
          initialJobStatus: null,
          finalJobStatus: null,
        },
        livingMemory: null,
        policyEpoch: getMemoryPolicyEpoch(),
      },
      consecutivePendingAsyncNoToolTurns: 0,
      lastPendingAsyncSignature: '',
      lastModelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      llm: {} as any,
      warningInjectedThisRound: false,
      workingMessages: [],
    },
    isSuperAgent: true,
    maxToolIterations: 2,
    maxTokens: 8000,
    promptContextSupport: {
      maxToolIterations: 2,
      resolvedPrompt: '',
      skillPrompts: [],
    },
    reportUsage: jest.fn(),
    refreshSessionMemoryContext: jest.fn().mockResolvedValue({
      consistencyBarrier: {
        outcome: 'degraded',
        durationMs: 0,
        waitedMs: 0,
        queryCount: 0,
        matchedJobCount: 0,
        queueAgeMs: null,
        initialJobStatus: null,
        finalJobStatus: null,
      },
      livingMemory: null,
    }),
    requestFrame: buildGraphEntryRequestFrame({
      text: 'Run the task',
      attachmentCount: 0,
      mode: 'agentic',
      continuation: 'new',
    }),
    thinkingLevel: 'off',
    toolRuntime: {
      availableToolNames: new Set<string>(),
      runtimeToolAvailability: {} as any,
      toolCallHistory: [],
    },
    trackedAsyncOperations: new Map(),
    warn: jest.fn(),
    yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ExecuteAgentControlGraphSessionParams;
}

describe('agentControlGraphSessionExecution', () => {
  beforeEach(() => {
    mockedEmitSessionEvent.mockClear();
    mockedExecuteAgentControlGraphIteration.mockReset();
  });

  it('finishes immediately when the graph is already terminal before an iteration starts', async () => {
    const params = createParams();
    (params.graph.getGraphSnapshot as jest.Mock).mockReturnValue({
      status: 'finalized',
      terminalReason: 'restored_final_state',
    } as any);

    await executeAgentControlGraphSession(params);

    expect(mockedEmitSessionEvent).toHaveBeenCalledWith('start', { conversationId: 'conv-1' });
    expect(params.graph.finishExistingTerminalSession).toHaveBeenCalledWith('restored_final_state');
    expect(mockedExecuteAgentControlGraphIteration).not.toHaveBeenCalled();
  });

  it('finalizes with the max-iterations summary when iterations keep continuing', async () => {
    const params = createParams({ maxToolIterations: 1 });
    params.initialRuntime.lastModelTurnMemoryRetrievalEventId = 'retrieval_event_max_iteration_1';
    mockedExecuteAgentControlGraphIteration.mockResolvedValue({
      status: 'continued',
      runtime: params.initialRuntime,
    });

    await executeAgentControlGraphSession(params);

    expect(mockedExecuteAgentControlGraphIteration).toHaveBeenCalledTimes(1);
    expect(params.graph.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "I've reached the maximum number of tool iterations. Here's what I've accomplished so far with the tools I've used.",
        graphEvent: {
          type: 'FINALIZED',
          reason: 'max_iterations',
        },
        assistantMetadata: expect.objectContaining({
          memoryRetrievalEventId: 'retrieval_event_max_iteration_1',
        }),
        sessionEndReason: 'max_iterations',
      }),
    );
  });

  it('extends a progressing default long-horizon run before its final-text-only turn', async () => {
    const params = createParams({
      allowLongHorizonIterationExtensions: true,
      maxToolIterations: 2,
    });
    params.toolRuntime.toolCallHistory.push(
      {
        name: 'read_file',
        arguments: '{"path":"input-a.txt"}',
        timestamp: 1,
        status: 'completed',
      },
      {
        name: 'read_file',
        arguments: '{"path":"input-b.txt"}',
        timestamp: 2,
        status: 'completed',
      },
    );
    mockedExecuteAgentControlGraphIteration
      .mockResolvedValueOnce({ status: 'continued', runtime: params.initialRuntime })
      .mockResolvedValueOnce({ status: 'continued', runtime: params.initialRuntime })
      .mockResolvedValueOnce({ status: 'finalized', runtime: params.initialRuntime });

    await executeAgentControlGraphSession(params);

    expect(mockedExecuteAgentControlGraphIteration).toHaveBeenCalledTimes(3);
    expect(
      mockedExecuteAgentControlGraphIteration.mock.calls.map(([input]) => ({
        iteration: input.iteration,
        maxToolIterations: input.maxToolIterations,
        promptMaxToolIterations: input.promptContextSupport.maxToolIterations,
      })),
    ).toEqual([
      { iteration: 1, maxToolIterations: 2, promptMaxToolIterations: 2 },
      { iteration: 2, maxToolIterations: 4, promptMaxToolIterations: 4 },
      { iteration: 3, maxToolIterations: 4, promptMaxToolIterations: 4 },
    ]);
    expect(params.graph.recordObservability).toHaveBeenCalledWith({
      observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.LONG_HORIZON_BUDGET_EXTENDED,
      iteration: 1,
      detail: 'from:2,to:4',
    });
    expect(params.graph.finishWithGraphTerminalEvent).not.toHaveBeenCalled();
  });

  it('retries an invalidated model turn without consuming the iteration budget', async () => {
    const params = createParams({ maxToolIterations: 1 });
    mockedExecuteAgentControlGraphIteration
      .mockResolvedValueOnce({
        status: 'retry_current_iteration',
        runtime: params.initialRuntime,
      })
      .mockResolvedValueOnce({
        status: 'finalized',
        runtime: params.initialRuntime,
      });

    await executeAgentControlGraphSession(params);

    expect(mockedExecuteAgentControlGraphIteration).toHaveBeenCalledTimes(2);
    expect(
      mockedExecuteAgentControlGraphIteration.mock.calls.map(([input]) => input.iteration),
    ).toEqual([1, 1]);
    expect(params.refreshSessionMemoryContext).toHaveBeenCalledTimes(1);
    expect(params.graph.finishWithGraphTerminalEvent).not.toHaveBeenCalled();
  });

  it('reprepares the last logical iteration when its exact binding expires before max delivery', async () => {
    const params = createParams({ maxToolIterations: 1 });
    const staleRuntime = {
      ...params.initialRuntime,
      lastModelTurnMemoryPolicyBinding: {
        kind: 'memory_epoch',
        readEpoch: -1,
      } as never,
    };
    const refreshedRuntime = {
      ...params.initialRuntime,
      lastModelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
    };
    mockedExecuteAgentControlGraphIteration
      .mockResolvedValueOnce({ status: 'continued', runtime: staleRuntime })
      .mockResolvedValueOnce({ status: 'continued', runtime: refreshedRuntime });

    await executeAgentControlGraphSession(params);

    expect(
      mockedExecuteAgentControlGraphIteration.mock.calls.map(([input]) => input.iteration),
    ).toEqual([1, 1]);
    expect(params.refreshSessionMemoryContext).toHaveBeenCalledTimes(1);
    expect(params.graph.applyAgentControlGraphEvents).toHaveBeenCalledWith([
      {
        type: 'MODEL_TURN_INVALIDATED',
        iteration: 1,
        reason: 'memory_authority_changed',
      },
    ]);
    expect(params.graph.finishWithGraphTerminalEvent).toHaveBeenCalledTimes(1);
    expect(params.graph.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: { type: 'FINALIZED', reason: 'max_iterations' },
        beforeAssistantDelivery: expect.any(Function),
      }),
    );
  });

  it('refreshes stale memory structurally without interpreting Arabic or Japanese text', async () => {
    const compactMessage = {
      id: 'compact_memory_projection',
      role: 'system' as const,
      content: 'ملخص قديم 以前の要約',
      timestamp: 1,
    };
    const arabicMessage = {
      id: 'user-ar',
      role: 'user' as const,
      content: 'تابع المهمة باستخدام تفضيلاتي الجديدة',
      timestamp: 2,
    };
    const japaneseMessage = {
      id: 'user-ja',
      role: 'user' as const,
      content: '新しい設定でタスクを続けてください',
      timestamp: 3,
    };
    const params = createParams({ maxToolIterations: 1 });
    params.initialRuntime.workingMessages = [compactMessage, arabicMessage, japaneseMessage];
    params.initialRuntime.admittedMemoryContext = {
      ...params.initialRuntime.admittedMemoryContext,
      admission: 'admitted',
      authoritySnapshot: {
        processEpochs: { restrictive: -1, projection: -1 },
        restrictiveRevision: { memoryOwnerId: 'owner', value: 0 },
        projectionRevision: { memoryOwnerId: 'owner', value: 0 },
        policy: { enabled: true, revision: 0 },
      },
    } as never;
    mockedExecuteAgentControlGraphIteration.mockResolvedValueOnce({
      status: 'finalized',
      runtime: params.initialRuntime,
    });

    await executeAgentControlGraphSession(params);

    expect(params.refreshSessionMemoryContext).toHaveBeenCalledTimes(1);
    expect(params.refreshSessionMemoryContext).toHaveBeenCalledWith(
      expect.objectContaining({
        workingMessages: [arabicMessage, japaneseMessage],
      }),
    );
    expect(mockedExecuteAgentControlGraphIteration).toHaveBeenCalledWith(
      expect.objectContaining({
        iteration: 1,
        runtime: expect.objectContaining({
          workingMessages: [arabicMessage, japaneseMessage],
        }),
      }),
    );
  });

  it('blocks with a typed terminal after two unstable authority repreparations', async () => {
    const params = createParams({ maxToolIterations: 1 });
    params.initialRuntime.admittedMemoryContext = {
      ...params.initialRuntime.admittedMemoryContext,
      admission: 'admitted',
      authoritySnapshot: {
        processEpochs: { restrictive: -1, projection: -1 },
        restrictiveRevision: { memoryOwnerId: 'owner', value: 0 },
        projectionRevision: { memoryOwnerId: 'owner', value: 0 },
        policy: { enabled: true, revision: 0 },
      },
    } as never;
    (params.refreshSessionMemoryContext as jest.Mock).mockResolvedValue({
      consistencyBarrier: {
        outcome: 'no_job',
        durationMs: 0,
        waitedMs: 0,
        queryCount: 0,
        matchedJobCount: 0,
        queueAgeMs: null,
        initialJobStatus: null,
        finalJobStatus: null,
      },
      livingMemory: {
        sections: [],
        cacheableSignature: 'empty',
        focusBlockText: '',
        openThreadLabels: [],
        recalledFactCount: 0,
        recalledEpisodeCount: 0,
        applicabilityPolicy: {},
        memoryAuthoritySnapshot: {
          processEpochs: { restrictive: -1, projection: -1 },
          restrictiveRevision: { memoryOwnerId: 'owner', value: 0 },
          projectionRevision: { memoryOwnerId: 'owner', value: 0 },
          policy: { enabled: true, revision: 0 },
        },
      },
    });

    await executeAgentControlGraphSession(params);

    expect(params.refreshSessionMemoryContext).toHaveBeenCalledTimes(2);
    expect(mockedExecuteAgentControlGraphIteration).not.toHaveBeenCalled();
    expect(params.graph.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: { type: 'BLOCKED', reason: 'memory_authority_unstable' },
        sessionEndReason: 'memory_authority_unstable',
      }),
    );
  });

  it('preserves the original failure when failure finalization rejects', async () => {
    const originalError = new Error('model turn failed');
    const finalizationError = new Error('finalization failed');
    const params = createParams();
    mockedExecuteAgentControlGraphIteration.mockRejectedValueOnce(originalError);
    (params.graph.finishFailure as jest.Mock).mockRejectedValueOnce(finalizationError);

    await expect(executeAgentControlGraphSession(params)).rejects.toBe(originalError);

    expect(params.graph.finishFailure).toHaveBeenCalledWith(originalError);
    expect(params.warn).toHaveBeenCalledWith(
      'Agent control graph failure finalization failed',
      finalizationError,
    );
  });
});
