import { reduceAgentControlGraph } from '../../src/engine/graph/agentControlGraph';
import { buildDelegationToolTerminalGraphEvents } from '../../src/engine/graph/delegationToolTerminalGraphEffects';
import { createInitialAgentRunControlGraphState } from '../../src/services/agents/agentControlGraphState';

describe('delegationToolTerminalGraphEffects', () => {
  it('emits GOAL_EVIDENCE_ADDED with worker prefix from terminal sessions_spawn JSON', () => {
    const controlGraph = reduceAgentControlGraph(
      createInitialAgentRunControlGraphState({ updatedAt: 100 }),
      [
        {
          type: 'GOALS_UPDATED',
          goals: [
            {
              id: 'worker-goal',
              title: 'Delegated work',
              status: 'active',
              dependencies: [],
              evidence: [],
              successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          timestamp: 100,
        },
      ],
    );

    const { events, applied } = buildDelegationToolTerminalGraphEvents({
      toolName: 'sessions_spawn',
      resultContent: JSON.stringify({
        sessionId: 'sub-worker',
        status: 'completed',
        completionState: 'verified_success',
        output: 'E2E-WORKER-EVIDENCE-42',
        workstreamId: 'worker-goal',
        toolsUsed: ['write_file'],
        iterations: 1,
        depth: 1,
      }),
      run: { controlGraph },
      timestamp: 200,
    });

    expect(applied).toBe(true);
    const evidenceEvent = events.find((event) => event.type === 'GOAL_EVIDENCE_ADDED');
    expect(evidenceEvent).toMatchObject({
      type: 'GOAL_EVIDENCE_ADDED',
      goalId: 'worker-goal',
    });
    expect(String((evidenceEvent as { evidence?: string }).evidence)).toContain('worker:');
    expect(String((evidenceEvent as { evidence?: string }).evidence)).toContain(
      'E2E-WORKER-EVIDENCE-42',
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'GOAL_EVIDENCE_ADDED',
          goalId: 'worker-goal',
          evidence: 'write_file:worker:sub-worker',
        }),
      ]),
    );
  });

  it('materializes a missing workstream goal before recording terminal worker evidence', () => {
    const controlGraph = createInitialAgentRunControlGraphState({ updatedAt: 100 });

    const { events, applied } = buildDelegationToolTerminalGraphEvents({
      toolName: 'sessions_spawn',
      resultContent: JSON.stringify({
        sessionId: 'sub-worker',
        status: 'completed',
        completionState: 'verified_success',
        output: 'E2E-WORKER-CHAIN-77',
        workstreamId: 'worker-chain',
        toolsUsed: ['write_file'],
        iterations: 1,
        depth: 1,
        name: 'Worker chain',
      }),
      run: { controlGraph },
      timestamp: 200,
    });

    expect(applied).toBe(true);
    const goalsEvent = events.find((event) => event.type === 'GOALS_UPDATED');
    expect(goalsEvent).toEqual(expect.objectContaining({ type: 'GOALS_UPDATED' }));
    expect((goalsEvent as { goals?: Array<{ id: string; status: string }> }).goals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'worker-chain',
          status: 'active',
        }),
      ]),
    );
    const evidenceEvent = events.find((event) => event.type === 'GOAL_EVIDENCE_ADDED');
    expect(evidenceEvent).toMatchObject({
      type: 'GOAL_EVIDENCE_ADDED',
      goalId: 'worker-chain',
    });
  });

  it('activates the delegated goal and records durable ownership on a running spawn', () => {
    const controlGraph = reduceAgentControlGraph(
      createInitialAgentRunControlGraphState({ updatedAt: 100 }),
      [
        {
          type: 'GOALS_UPDATED',
          goals: [
            {
              id: 'parent-goal',
              title: 'Parent work',
              status: 'active',
              completionPolicy: 'blocking',
              dependencies: [],
              evidence: [],
              successCriteria: ['evidence.artifact:artifacts/report.md'],
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 'worker-goal',
              title: 'Delegated work',
              status: 'pending',
              completionPolicy: 'blocking',
              owner: 'delegated-worker',
              requiredCapabilities: ['coordinate'],
              dependencies: [],
              evidence: [],
              successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          timestamp: 100,
        },
      ],
    );
    const { events, applied } = buildDelegationToolTerminalGraphEvents({
      toolName: 'sessions_spawn',
      resultContent: JSON.stringify({
        status: 'running',
        sessionId: 'sub-worker',
        workstreamId: 'worker-goal',
      }),
      run: { controlGraph },
      timestamp: 200,
    });

    expect(applied).toBe(true);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'GOALS_UPDATED',
          reason: 'delegation:worker_launched',
        }),
        expect.objectContaining({
          type: 'GOAL_EVIDENCE_ADDED',
          goalId: 'worker-goal',
          evidence: 'delegation_launch:sub-worker',
        }),
      ]),
    );
    const goalsEvent = events.find((event) => event.type === 'GOALS_UPDATED');
    const goals = (goalsEvent as { goals: Array<{ id: string; status: string }> }).goals;
    expect(goals.find((goal) => goal.id === 'worker-goal')?.status).toBe('active');
    expect(goals.find((goal) => goal.id === 'parent-goal')?.status).toBe('active');
  });

  it('blocks the owned goal when terminal worker prose lacks verified semantic completion', () => {
    const controlGraph = reduceAgentControlGraph(
      createInitialAgentRunControlGraphState({ updatedAt: 100 }),
      [
        {
          type: 'GOALS_UPDATED',
          goals: [
            {
              id: 'worker-goal',
              title: 'Delegated work',
              status: 'active',
              completionPolicy: 'blocking',
              owner: 'delegated-worker',
              requiredCapabilities: ['coordinate'],
              dependencies: [],
              evidence: ['delegation_launch:sub-worker'],
              successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          timestamp: 100,
        },
      ],
    );
    const { events, applied } = buildDelegationToolTerminalGraphEvents({
      toolName: 'sessions_spawn',
      resultContent: JSON.stringify({
        status: 'completed',
        completionState: 'incomplete',
        sessionId: 'sub-worker',
        output: 'Looks done to me.',
        workstreamId: 'worker-goal',
      }),
      run: { controlGraph },
      timestamp: 200,
    });

    expect(applied).toBe(true);
    const goalsEvent = events.find((event) => event.type === 'GOALS_UPDATED');
    expect(goalsEvent).toEqual(
      expect.objectContaining({
        type: 'GOALS_UPDATED',
        reason: 'delegation:worker_not_verified',
      }),
    );
    const goals = (goalsEvent as { goals: Array<{ id: string; status: string }> }).goals;
    expect(goals.find((goal) => goal.id === 'worker-goal')?.status).toBe('blocked');
    expect(events.some((event) => event.type === 'GOAL_EVIDENCE_ADDED')).toBe(false);
  });

  it('recovers verified terminal graph evidence from compact spill metadata', () => {
    const controlGraph = reduceAgentControlGraph(
      createInitialAgentRunControlGraphState({ updatedAt: 100 }),
      [
        {
          type: 'GOALS_UPDATED',
          goals: [
            {
              id: 'worker-goal',
              title: 'Delegated work',
              status: 'active',
              dependencies: [],
              evidence: [],
              successCriteria: [
                'evidence.prefix:worker',
                'evidence.min:1',
                'evidence.tool:read_file',
              ],
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          timestamp: 100,
        },
      ],
    );

    const { events, applied } = buildDelegationToolTerminalGraphEvents({
      toolName: 'sessions_wait',
      resultContent: JSON.stringify({
        status: 'spilled',
        path: '.kavi/spill/sessions_wait-1.txt',
        structuralResult: {
          version: 1,
          kind: 'delegation_sessions',
          sessions: [
            {
              sessionId: 'sub-worker',
              status: 'completed',
              completionState: 'verified_success',
              outputPreview: 'Verified source review.',
              workstreamId: 'worker-goal',
              toolsUsed: ['read_file'],
              iterations: 10,
              depth: 1,
            },
          ],
        },
      }),
      run: { controlGraph },
      timestamp: 200,
    });

    expect(applied).toBe(true);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'GOAL_EVIDENCE_ADDED',
          goalId: 'worker-goal',
          evidence: 'read_file:worker:sub-worker',
        }),
      ]),
    );
  });
});
