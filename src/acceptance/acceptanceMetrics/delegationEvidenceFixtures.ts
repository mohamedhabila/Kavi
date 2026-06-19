// ---------------------------------------------------------------------------
// Kavi — Delegation worker evidence → completion gate fixtures (structural)
// ---------------------------------------------------------------------------

import { buildGoalsAfterDelegationWorkerTerminal } from '../../engine/graph/delegationFixtureSupport';
import type { TrackedAsyncOperation } from '../../engine/pendingAsyncOperations';
import type { AgentGoal } from '../../types/agentRun';
import type { FalseFinalizeGateParams } from './falseFinalizeFixtures';

export type DelegationEvidenceExpectation = 'must_hold' | 'must_ready' | 'must_auto_complete';

export type DelegationEvidenceFixture = {
  id: string;
  expectation: DelegationEvidenceExpectation;
  params: FalseFinalizeGateParams;
};

const baseTurnDirectives = {
  forceFinalText: false,
  requireWorkflowTool: false,
  incompleteFinalTextRecoveryCount: 0,
};

function goal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    id: 'worker-goal',
    title: 'Delegated work',
    status: 'active',
    dependencies: [],
    evidence: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function pendingWorkerOperation(
  overrides: Partial<TrackedAsyncOperation> = {},
): TrackedAsyncOperation {
  return {
    key: 'session:sub-worker',
    kind: 'session',
    resourceId: 'sub-worker',
    displayName: 'Worker',
    status: 'running',
    lastUpdatedByTool: 'sessions_spawn',
    updatedAt: 1000,
    monitorToolNames: ['sessions_wait'],
    waitToolName: 'sessions_wait',
    waitArgs: { sessionId: 'sub-worker', workstreamId: 'worker-goal' },
    ...overrides,
  };
}

function baseParams(overrides: Partial<FalseFinalizeGateParams> = {}): FalseFinalizeGateParams {
  return {
    trackedOperations: new Map(),
    pendingOperations: [],
    consecutivePendingAsyncNoToolTurns: 0,
    hasDraftContent: true,
    goals: [],
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

export const DELEGATION_EVIDENCE_FIXTURES: DelegationEvidenceFixture[] = [
  {
    id: 'hold-worker-evidence-unmet',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        goal({
          successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
          evidence: [],
        }),
      ],
    }),
  },
  {
    id: 'hold-active-worker-awaiting-terminal',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        goal({
          successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
          evidence: [],
        }),
      ],
      pendingOperations: [pendingWorkerOperation()],
      trackedOperations: new Map([['session:sub-worker', pendingWorkerOperation()]]),
    }),
  },
  {
    id: 'ready-worker-evidence-met-completed-goal',
    expectation: 'must_ready',
    params: baseParams({
      goals: buildGoalsAfterDelegationWorkerTerminal('completed'),
    }),
  },
  {
    id: 'auto-complete-worker-evidence-met-active-goal',
    expectation: 'must_auto_complete',
    params: baseParams({
      selectedToolNames: new Set(['update_goals', 'sessions_spawn', 'sessions_wait']),
      goals: buildGoalsAfterDelegationWorkerTerminal('active'),
    }),
  },
  {
    id: 'auto-complete-worker-evidence-met-blocked-goal',
    expectation: 'must_auto_complete',
    params: baseParams({
      selectedToolNames: new Set(['update_goals', 'sessions_spawn', 'sessions_wait']),
      goals: buildGoalsAfterDelegationWorkerTerminal('blocked'),
    }),
  },
];
