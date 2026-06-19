import type { AgentRun } from '../../../src/types/agentRun';
import type { SubAgentSnapshot } from '../../../src/types/subAgent';
import { reduceAgentControlGraph } from '../../../src/engine/graph/agentControlGraph';
import { createInitialAgentRunControlGraphState } from '../../../src/services/agents/agentControlGraphState';
import { applySubAgentTerminalControlGraphEffects } from '../../../src/services/agents/subAgentGoalGraphEffects';
import { resolveSpawnGoalScope } from '../../../src/services/agents/mobileSpawnPolicy';

function buildWorker(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'sub-1',
    parentConversationId: 'conv-1',
    depth: 1,
    startedAt: 10,
    updatedAt: 20,
    status: 'completed',
    sandboxPolicy: 'inherit',
    launchState: 'terminal',
    output: 'Verified worker findings.',
    workstreamId: 'goal-a',
    ...overrides,
  };
}

describe('subAgent goal scope integration', () => {
  it('binds spawn goalScope to parent graph goals', () => {
    const goals = [
      {
        id: 'goal-a',
        title: 'Collect sources',
        status: 'active' as const,
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(
      resolveSpawnGoalScope({
        goalIds: ['goal-a'],
        goals,
      }),
    ).toEqual({
      status: 'ready',
      workstreamId: 'goal-a',
      scopedGoals: goals,
    });
  });

  it('records GOAL_EVIDENCE_ADDED on the active goal when workstreamId is missing', () => {
    const baseGraph = reduceAgentControlGraph(
      createInitialAgentRunControlGraphState({ updatedAt: 100 }),
      [
        {
          type: 'GOALS_UPDATED',
          goals: [
            {
              id: 'goal-active',
              title: 'Collect sources',
              status: 'active',
              dependencies: [],
              evidence: [],
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          timestamp: 100,
        },
      ],
    );

    const run: AgentRun = {
      id: 'run-1',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      controlGraph: baseGraph,
    };
    const worker = buildWorker({ workstreamId: undefined, output: 'Fallback worker output.' });

    const nextGraph = applySubAgentTerminalControlGraphEffects({
      run,
      agent: worker,
      event: 'completed',
      timestamp: 200,
    });

    expect(nextGraph?.goals?.[0]?.evidence.length).toBe(1);
    expect(nextGraph?.goals?.[0]?.evidence[0]).toContain('Fallback worker output.');
  });

  it('records GOAL_EVIDENCE_ADDED and clears terminal async work on child completion', () => {
    const baseGraph = reduceAgentControlGraph(
      createInitialAgentRunControlGraphState({ updatedAt: 100 }),
      [
        {
          type: 'GOALS_UPDATED',
          goals: [
            {
              id: 'goal-a',
              title: 'Collect sources',
              status: 'active',
              dependencies: [],
              evidence: [],
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          timestamp: 100,
        },
        {
          type: 'ASYNC_WAITING',
          pendingAsyncCount: 1,
          pendingOperations: [
            {
              key: 'session:sub-1',
              kind: 'session',
              resourceId: 'sub-1',
              displayName: 'Session sub-1',
              status: 'running',
              blocksFinalization: false,
              lastUpdatedByTool: 'sessions_spawn',
              updatedAt: 100,
              monitorToolNames: ['sessions_wait'],
              waitToolName: 'sessions_wait',
              waitArgs: { sessionId: 'sub-1', workstreamId: 'goal-a' },
            },
          ],
          awaitingBackgroundWorkers: true,
          timestamp: 100,
        },
      ],
    );

    const run: AgentRun = {
      id: 'run-1',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      controlGraph: baseGraph,
    };
    const worker = buildWorker();

    const nextGraph = applySubAgentTerminalControlGraphEffects({
      run,
      agent: worker,
      event: 'completed',
      timestamp: 200,
    });

    expect(nextGraph?.goals?.[0]?.evidence.length).toBe(1);
    expect(nextGraph?.goals?.[0]?.evidence[0]).toContain('Verified worker findings.');
    expect(nextGraph?.asyncWork.pendingOperations).toEqual([]);
    expect(nextGraph?.asyncWork.awaitingBackgroundWorkers).toBe(true);
    expect(nextGraph?.status).toBe('ready');
  });
});
