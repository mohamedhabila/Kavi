// ---------------------------------------------------------------------------
// Kavi — False-finalize completion gate fixtures (structural)
// ---------------------------------------------------------------------------

import type { AgentControlTurnDirectives } from '../../engine/graph/agentControlGraph';
import type { TrackedAsyncOperation } from '../../engine/pendingAsyncOperations';

export type FalseFinalizeGateParams = {
  trackedOperations: Map<string, TrackedAsyncOperation>;
  pendingOperations: TrackedAsyncOperation[];
  consecutivePendingAsyncNoToolTurns: number;
  hasDraftContent: boolean;
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  selectedToolNames?: ReadonlySet<string>;
  forceTextThisTurn: boolean;
  fullContent: string;
  recoveryDirectives: AgentControlTurnDirectives;
  completion?: {
    completionStatus: 'complete' | 'incomplete';
    finishReason?: string;
  };
  nextFinalizationMaxTokens: number;
};

export type FalseFinalizeFixture = {
  id: string;
  expectation: 'must_hold' | 'must_ready';
  params: FalseFinalizeGateParams;
};

const baseTurnDirectives: AgentControlTurnDirectives = {
  forceFinalText: false,
  requireWorkflowTool: false,
  incompleteFinalTextRecoveryCount: 0,
};

function pendingOperation(overrides: Partial<TrackedAsyncOperation> = {}): TrackedAsyncOperation {
  return {
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
    ...overrides,
  };
}

function baseParams(overrides: Partial<FalseFinalizeGateParams> = {}): FalseFinalizeGateParams {
  return {
    trackedOperations: new Map(),
    pendingOperations: [],
    consecutivePendingAsyncNoToolTurns: 0,
    hasDraftContent: true,
    toolingEnabledForProvider: true,
    selectedToolCount: 2,
    forceTextThisTurn: false,
    fullContent: 'final answer',
    recoveryDirectives: baseTurnDirectives,
    completion: { completionStatus: 'complete', finishReason: 'stop' },
    nextFinalizationMaxTokens: 4096,
    ...overrides,
  };
}

/**
 * What may hold a final answer. Goals never do: the model ends a request by answering.
 * Work still in flight and a visibly truncated answer do.
 */
export const FALSE_FINALIZE_FIXTURES: FalseFinalizeFixture[] = [
  {
    id: 'hold-async-pending',
    expectation: 'must_hold',
    params: baseParams({
      pendingOperations: [pendingOperation()],
      trackedOperations: new Map([['session:worker-1', pendingOperation()]]),
    }),
  },
  {
    id: 'hold-incomplete-delivery',
    expectation: 'must_hold',
    params: baseParams({
      fullContent: 'partial final',
      completion: { completionStatus: 'incomplete', finishReason: 'length' },
    }),
  },
  {
    id: 'ready-final-answer',
    expectation: 'must_ready',
    params: baseParams(),
  },
  {
    id: 'ready-tools-disabled',
    expectation: 'must_ready',
    params: baseParams({ toolingEnabledForProvider: false }),
  },
];
