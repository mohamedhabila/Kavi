import { evaluateCompletionGate } from '../../src/engine/graph/completionGate';
import type { AgentGoal } from '../../src/types/agentRun';
import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';

describe('completion precedence integration', () => {
  it('orders async pending ahead of goals and delivery blockers', () => {
    const pendingOperation: TrackedAsyncOperation = {
      key: 'session:worker-1',
      kind: 'session',
      resourceId: 'worker-1',
      displayName: 'Worker 1',
      status: 'running',
      lastUpdatedByTool: 'sessions_spawn',
      updatedAt: 1000,
      monitorToolNames: ['sessions_wait'],
      waitToolName: 'sessions_wait',
      waitArgs: { sessionId: 'worker-1' },
    };
    const goals: AgentGoal[] = [
      {
        id: 'g1',
        title: 'Finish task',
        status: 'active',
        completionPolicy: 'blocking',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const decision = evaluateCompletionGate({
      trackedOperations: new Map([[pendingOperation.key, pendingOperation]]),
      pendingOperations: [pendingOperation],
      consecutivePendingAsyncNoToolTurns: 0,
      hasDraftContent: true,
      goals,
      toolingEnabledForProvider: true,
      selectedToolCount: 2,
      forceTextThisTurn: false,
      fullContent: 'partial final answer',
      recoveryDirectives: {
        forceFinalText: false,
        requireWorkflowTool: false,
        incompleteFinalTextRecoveryCount: 0,
      },
      completion: {
        completionStatus: 'incomplete',
        finishReason: 'length',
      },
      nextFinalizationMaxTokens: 4096,
    });

    expect(decision.type).toBe('hold');
    if (decision.type === 'hold') {
      expect(decision.reason).toBe('async_waiting_finalization_hold');
    }
  });

  it('orders goals incomplete ahead of delivery continuation', () => {
    const decision = evaluateCompletionGate({
      trackedOperations: new Map(),
      pendingOperations: [],
      consecutivePendingAsyncNoToolTurns: 0,
      hasDraftContent: true,
      goals: [
        {
          id: 'g1',
          title: 'Finish task',
          status: 'pending',
          completionPolicy: 'blocking',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      toolingEnabledForProvider: true,
      selectedToolCount: 2,
      forceTextThisTurn: false,
      fullContent: 'partial final answer',
      recoveryDirectives: {
        forceFinalText: false,
        requireWorkflowTool: false,
        incompleteFinalTextRecoveryCount: 0,
      },
      completion: {
        completionStatus: 'incomplete',
        finishReason: 'length',
      },
      nextFinalizationMaxTokens: 4096,
    });

    expect(decision.type).toBe('hold');
    if (decision.type === 'hold') {
      expect(decision.reason).toBe('goals_incomplete');
    }
  });
});
