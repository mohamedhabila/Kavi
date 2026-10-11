import { evaluateCompletionGate } from '../../src/engine/graph/completionGate';
import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';

describe('completion precedence integration', () => {
  it('orders async pending ahead of delivery blockers', () => {
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
    const decision = evaluateCompletionGate({
      trackedOperations: new Map([[pendingOperation.key, pendingOperation]]),
      pendingOperations: [pendingOperation],
      consecutivePendingAsyncNoToolTurns: 0,
      hasDraftContent: true,
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
});
