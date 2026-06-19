// ---------------------------------------------------------------------------
// Kavi — False-finalize completion gate fixtures (structural)
// ---------------------------------------------------------------------------

import type { AgentControlTurnDirectives } from '../../engine/graph/agentControlGraph';
import type { AgentGoal } from '../../types/agentRun';
import type { TrackedAsyncOperation } from '../../engine/pendingAsyncOperations';

export type FalseFinalizeGateParams = {
  trackedOperations: Map<string, TrackedAsyncOperation>;
  pendingOperations: TrackedAsyncOperation[];
  consecutivePendingAsyncNoToolTurns: number;
  hasDraftContent: boolean;
  goals: AgentGoal[];
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

function goal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    id: 'g1',
    title: 'Finish task',
    status: 'active',
    dependencies: [],
    evidence: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function blockingGoal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return goal({
    completionPolicy: 'blocking',
    ...overrides,
  });
}

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

export const FALSE_FINALIZE_FIXTURES: FalseFinalizeFixture[] = [
  {
    id: 'hold-active-goal',
    expectation: 'must_hold',
    params: baseParams({ goals: [blockingGoal({ status: 'active' })] }),
  },
  {
    id: 'hold-active-goal-evidence-satisfied',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        goal({
          id: 'gate-followup',
          status: 'active',
          successCriteria: ['evidence.prefix:write_file', 'evidence.min:1'],
          evidence: ['write_file:artifacts/e2e-follow-gate.txt'],
        }),
      ],
    }),
  },
  {
    id: 'hold-pending-goal',
    expectation: 'must_hold',
    params: baseParams({ goals: [blockingGoal({ status: 'pending' })] }),
  },
  {
    id: 'hold-mixed-goals',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        blockingGoal({ id: 'g-active', status: 'active' }),
        blockingGoal({ id: 'g-pending', status: 'pending' }),
      ],
    }),
  },
  {
    id: 'hold-evidence-min-unmet',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        goal({
          successCriteria: ['evidence.min:2'],
          evidence: ['read_file:one'],
        }),
      ],
    }),
  },
  {
    id: 'hold-evidence-prefix-unmet',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        goal({
          successCriteria: ['evidence.prefix:python'],
          evidence: ['read_file:config.json'],
        }),
      ],
    }),
  },
  {
    id: 'hold-evidence-tool-unmet',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        goal({
          successCriteria: ['evidence.tool:write_file'],
          evidence: ['read_file:config.json'],
        }),
      ],
    }),
  },
  {
    id: 'hold-evidence-artifact-unmet',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        goal({
          successCriteria: ['evidence.artifact:artifacts/e2e-gate.txt'],
          evidence: ['write_file:Wrote to artifacts/other.txt'],
        }),
      ],
    }),
  },
  {
    id: 'hold-evidence-count-unmet',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        goal({
          successCriteria: ['evidence.count:2'],
          evidence: ['write_file:one'],
        }),
      ],
    }),
  },
  {
    id: 'hold-evidence-json-field-unmet',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        goal({
          successCriteria: ['evidence.json_field:status:ok'],
          evidence: ['native_calendar:{"status":"error"}'],
        }),
      ],
    }),
  },
  {
    id: 'hold-evidence-file-hash-unmet',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        goal({
          successCriteria: ['evidence.file_hash:artifacts/out.txt:sha256'],
          evidence: ['write_file:Wrote to artifacts/out.txt'],
        }),
      ],
    }),
  },
  {
    id: 'hold-evidence-exit-code-unmet',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        goal({
          successCriteria: ['evidence.exit_code:0'],
          evidence: ['python:exit_code:1'],
        }),
      ],
    }),
  },
  {
    id: 'hold-async-pending',
    expectation: 'must_hold',
    params: baseParams({
      goals: [goal({ status: 'completed' })],
      pendingOperations: [pendingOperation()],
      trackedOperations: new Map([['session:worker-1', pendingOperation()]]),
    }),
  },
  {
    id: 'hold-incomplete-delivery',
    expectation: 'must_hold',
    params: baseParams({
      goals: [goal({ status: 'completed' })],
      fullContent: 'partial final',
      completion: { completionStatus: 'incomplete', finishReason: 'length' },
    }),
  },
  {
    id: 'hold-active-and-evidence-gap',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        goal({
          status: 'active',
          successCriteria: ['evidence.min:1'],
          evidence: [],
        }),
      ],
    }),
  },
  {
    id: 'hold-pending-with-tools',
    expectation: 'must_hold',
    params: baseParams({
      goals: [blockingGoal({ id: 'g-queue', status: 'pending', title: 'Queued work' })],
      selectedToolCount: 3,
    }),
  },
  {
    id: 'hold-active-multi-criteria',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        goal({
          successCriteria: ['evidence.min:1', 'evidence.prefix:write_file'],
          evidence: [],
        }),
      ],
    }),
  },
  {
    id: 'hold-async-with-active-goal',
    expectation: 'must_hold',
    params: baseParams({
      goals: [blockingGoal({ status: 'active' })],
      pendingOperations: [pendingOperation({ key: 'session:worker-2', resourceId: 'worker-2' })],
      trackedOperations: new Map([
        ['session:worker-2', pendingOperation({ key: 'session:worker-2', resourceId: 'worker-2' })],
      ]),
    }),
  },
  {
    id: 'hold-evidence-min-partial',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        goal({
          successCriteria: ['evidence.min:3'],
          evidence: ['tool:a', 'tool:b'],
        }),
      ],
    }),
  },
  {
    id: 'hold-two-active-goals',
    expectation: 'must_hold',
    params: baseParams({
      goals: [
        blockingGoal({ id: 'g-a', status: 'active', title: 'Task A' }),
        blockingGoal({ id: 'g-b', status: 'active', title: 'Task B' }),
      ],
    }),
  },
  {
    id: 'hold-pending-dependency',
    expectation: 'must_hold',
    params: baseParams({
      goals: [blockingGoal({ id: 'g-child', status: 'pending', dependencies: ['g-parent'] })],
    }),
  },
  {
    id: 'hold-incomplete-with-active-goal',
    expectation: 'must_hold',
    params: baseParams({
      goals: [blockingGoal({ status: 'active' })],
      fullContent: 'truncated',
      completion: { completionStatus: 'incomplete', finishReason: 'length' },
    }),
  },
  {
    id: 'ready-completed-goals',
    expectation: 'must_ready',
    params: baseParams({ goals: [goal({ status: 'completed' })] }),
  },
  {
    id: 'ready-no-goals',
    expectation: 'must_ready',
    params: baseParams({ goals: [] }),
  },
  {
    id: 'ready-completed-with-evidence',
    expectation: 'must_ready',
    params: baseParams({
      goals: [
        goal({
          status: 'completed',
          successCriteria: ['evidence.min:1'],
          evidence: ['write_file:done.txt'],
        }),
      ],
    }),
  },
  {
    id: 'ready-evidence-tool-met',
    expectation: 'must_ready',
    params: baseParams({
      goals: [
        goal({
          status: 'completed',
          successCriteria: ['evidence.tool:write_file'],
          evidence: ['write_file:artifacts/e2e.txt'],
        }),
      ],
    }),
  },
  {
    id: 'ready-evidence-artifact-met',
    expectation: 'must_ready',
    params: baseParams({
      goals: [
        goal({
          status: 'completed',
          successCriteria: ['evidence.artifact:artifacts/out.txt'],
          evidence: ['write_file:Wrote to artifacts/out.txt'],
        }),
      ],
    }),
  },
  {
    id: 'ready-evidence-count-met',
    expectation: 'must_ready',
    params: baseParams({
      goals: [
        goal({
          status: 'completed',
          successCriteria: ['evidence.count:2'],
          evidence: ['write_file:one', 'read_file:two'],
        }),
      ],
    }),
  },
  {
    id: 'ready-evidence-json-field-met',
    expectation: 'must_ready',
    params: baseParams({
      goals: [
        goal({
          status: 'completed',
          successCriteria: ['evidence.json_field:status:ok'],
          evidence: ['native_calendar:{"status":"ok","count":2}'],
        }),
      ],
    }),
  },
  {
    id: 'ready-evidence-file-hash-met',
    expectation: 'must_ready',
    params: baseParams({
      goals: [
        goal({
          status: 'completed',
          successCriteria: ['evidence.file_hash:artifacts/out.txt:sha256'],
          evidence: [
            'write_file:file_hash:artifacts/out.txt:sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          ],
        }),
      ],
    }),
  },
  {
    id: 'ready-evidence-exit-code-met',
    expectation: 'must_ready',
    params: baseParams({
      goals: [
        goal({
          status: 'completed',
          successCriteria: ['evidence.exit_code:0'],
          evidence: ['python:exit_code:0'],
        }),
      ],
    }),
  },
  {
    id: 'ready-blocked-goal-only',
    expectation: 'must_ready',
    params: baseParams({ goals: [goal({ status: 'blocked' })] }),
  },
  {
    id: 'ready-tools-disabled',
    expectation: 'must_ready',
    params: baseParams({
      goals: [goal({ status: 'active' })],
      toolingEnabledForProvider: false,
    }),
  },
];
