import { reduceAgentControlGraph } from '../../src/engine/graph/agentControlGraph';
import { buildDelegationToolTerminalGraphEvents } from '../../src/engine/graph/delegationToolTerminalGraphEffects';
import { createInitialAgentRunControlGraphState } from '../../src/services/agents/agentControlGraphState';

// Live on delegation-worker-finalize, a worker finished verified_success and the
// supervisor collected it with sessions_wait — whose result wraps the sessions it waited
// on under a summary `status`. That summary was read as the worker, no worker came out of
// it, and the goal kept only its launch evidence, so the supervisor ended blocked.

function goal(id: string) {
  return {
    id,
    title: id,
    status: 'active' as const,
    dependencies: [],
    evidence: [],
    successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
    createdAt: 1,
    updatedAt: 1,
  };
}

function pending(sessionId: string, workstreamId: string) {
  return {
    key: `session:${sessionId}`,
    kind: 'session' as const,
    resourceId: sessionId,
    displayName: `Session ${sessionId}`,
    status: 'running' as const,
    blocksFinalization: true,
    lastUpdatedByTool: 'sessions_spawn',
    updatedAt: 100,
    monitorToolNames: ['sessions_wait', 'sessions_cancel'],
    waitToolName: 'sessions_wait',
    statusArgs: { sessionId, workstreamId },
    waitArgs: { sessionId, workstreamId },
  };
}

function graphWith(goalIds: string[], sessions: Array<[string, string]>) {
  return reduceAgentControlGraph(createInitialAgentRunControlGraphState({ updatedAt: 100 }), [
    { type: 'GOALS_UPDATED', goals: goalIds.map(goal), timestamp: 100 },
    {
      type: 'ASYNC_WAITING',
      pendingAsyncCount: sessions.length,
      pendingOperations: sessions.map(([sessionId, workstreamId]) =>
        pending(sessionId, workstreamId),
      ),
      timestamp: 100,
    },
  ]);
}

function waitResult(sessions: Array<{ sessionId: string; workstreamId: string; output: string }>) {
  return JSON.stringify({
    status: 'completed',
    sessionIds: sessions.map((session) => session.sessionId),
    sessionCount: sessions.length,
    completedCount: sessions.length,
    pendingCount: 0,
    sessions: sessions.map((session) => ({
      ...session,
      status: 'completed',
      terminationCause: 'completed',
      completionState: 'verified_success',
      hasOutput: true,
      toolsUsed: [],
      iterations: 0,
      depth: 1,
    })),
  });
}

describe('collecting workers with sessions_wait', () => {
  it('records the worker evidence a verified worker produced', () => {
    const controlGraph = graphWith(['worker-task'], [['sub-1', 'worker-task']]);

    const { events, applied } = buildDelegationToolTerminalGraphEvents({
      toolName: 'sessions_wait',
      resultContent: waitResult([
        { sessionId: 'sub-1', workstreamId: 'worker-task', output: 'E2E-WORKER-EVIDENCE-42' },
      ]),
      run: { controlGraph },
      timestamp: 200,
    });

    expect(applied).toBe(true);
    const evidence = events
      .filter((event) => event.type === 'GOAL_EVIDENCE_ADDED')
      .map((event) => (event as { goalId: string; evidence: string }).evidence);
    expect(evidence).toEqual([expect.stringMatching(/^worker:.*E2E-WORKER-EVIDENCE-42/)]);
    const next = reduceAgentControlGraph(controlGraph, events);
    expect(next.asyncWork?.pendingOperations ?? []).toEqual([]);
  });

  it('credits every worker the wait collected and clears each from pending work', () => {
    const controlGraph = graphWith(
      ['research', 'summary'],
      [
        ['sub-1', 'research'],
        ['sub-2', 'summary'],
      ],
    );

    const { events } = buildDelegationToolTerminalGraphEvents({
      toolName: 'sessions_wait',
      resultContent: waitResult([
        { sessionId: 'sub-1', workstreamId: 'research', output: 'Three sources agree.' },
        { sessionId: 'sub-2', workstreamId: 'summary', output: 'One-paragraph summary.' },
      ]),
      run: { controlGraph },
      timestamp: 200,
    });

    const next = reduceAgentControlGraph(controlGraph, events);
    const evidenceFor = (goalId: string) =>
      next.goals?.find((candidate) => candidate.id === goalId)?.evidence ?? [];
    expect(evidenceFor('research')).toEqual([expect.stringMatching(/^worker:/)]);
    expect(evidenceFor('summary')).toEqual([expect.stringMatching(/^worker:/)]);
    expect(next.asyncWork?.pendingOperations ?? []).toEqual([]);
  });

  it('records nothing while the waited-on worker is still running', () => {
    const controlGraph = graphWith(['worker-task'], [['sub-1', 'worker-task']]);

    const { events, applied } = buildDelegationToolTerminalGraphEvents({
      toolName: 'sessions_wait',
      resultContent: JSON.stringify({
        status: 'timeout',
        sessionIds: ['sub-1'],
        sessions: [{ sessionId: 'sub-1', status: 'running', workstreamId: 'worker-task' }],
      }),
      run: { controlGraph },
      timestamp: 200,
    });

    expect(applied).toBe(false);
    expect(events).toEqual([]);
  });
});
