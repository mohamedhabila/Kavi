import {
  evaluateMobileSpawnPreflight,
  MAX_CONCURRENT_SUB_AGENTS,
  MAX_SPAWN_DEPTH,
  resolveSpawnGoalScope,
} from '../../../src/services/agents/mobileSpawnPolicy';
import type { AgentGoal } from '../../../src/types/agentRun';

const goals: AgentGoal[] = [
  {
    id: 'goal-a',
    title: 'Research topic',
    status: 'active',
    dependencies: [],
    evidence: [],
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'goal-b',
    title: 'Draft summary',
    status: 'pending',
    dependencies: ['goal-a'],
    evidence: [],
    createdAt: 2,
    updatedAt: 2,
  },
];

describe('mobileSpawnPolicy constants', () => {
  it('uses mobile-bounded depth and concurrency limits', () => {
    expect(MAX_SPAWN_DEPTH).toBe(2);
    expect(MAX_CONCURRENT_SUB_AGENTS).toBe(1);
  });
});

describe('evaluateMobileSpawnPreflight', () => {
  it('rejects spawn when depth is at or above MAX_SPAWN_DEPTH', () => {
    expect(
      evaluateMobileSpawnPreflight({
        depth: MAX_SPAWN_DEPTH,
        parentConversationId: 'conv-1',
        liveWorkers: [],
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'blocked',
        code: 'max_depth',
      }),
    );
  });

  it('rejects a second concurrent worker for the same parent conversation', () => {
    const result = evaluateMobileSpawnPreflight({
      depth: 0,
      parentConversationId: 'conv-1',
      agentRunId: 'run-1',
      liveWorkers: [
        {
          sessionId: 'sub-running',
          parentConversationId: 'conv-1',
          agentRunId: 'run-1',
          status: 'running',
        },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'blocked',
        code: 'max_concurrent',
        sessionId: 'sub-running',
      }),
    );
  });

  it('allows spawn when prior worker is terminal', () => {
    const result = evaluateMobileSpawnPreflight({
      depth: 0,
      parentConversationId: 'conv-1',
      liveWorkers: [
        {
          sessionId: 'sub-done',
          parentConversationId: 'conv-1',
          status: 'completed',
        },
      ],
    });

    expect(result).toEqual({ status: 'ready' });
  });
});

describe('resolveSpawnGoalScope', () => {
  it('resolves a read-only goal id subset against the parent graph', () => {
    const result = resolveSpawnGoalScope({
      goalIds: ['goal-b'],
      goals,
    });

    expect(result).toEqual({
      status: 'ready',
      workstreamId: 'goal-b',
      scopedGoals: [goals[1]],
    });
  });

  it('rejects unknown goal ids', () => {
    const result = resolveSpawnGoalScope({
      goalIds: ['missing-goal'],
      goals,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'error',
      }),
    );
  });

  it('allows structured workstream scope to materialize against an empty graph', () => {
    const result = resolveSpawnGoalScope({
      goalIds: ['worker-chain'],
      workstreamId: 'worker-chain',
      goals: [],
    });

    expect(result).toEqual({
      status: 'ready',
      workstreamId: 'worker-chain',
      scopedGoals: [],
    });
  });

  it('allows workstream id scope to materialize against an empty graph', () => {
    const result = resolveSpawnGoalScope({
      workstreamId: 'worker-chain',
      goals: [],
    });

    expect(result).toEqual({
      status: 'ready',
      workstreamId: 'worker-chain',
      scopedGoals: [],
    });
  });

  it('requires workstreamId to be included in goalScope.goalIds', () => {
    const result = resolveSpawnGoalScope({
      goalIds: ['goal-a'],
      workstreamId: 'goal-b',
      goals,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'error',
      }),
    );
  });
});
