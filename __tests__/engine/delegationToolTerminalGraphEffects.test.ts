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
  });

  it('materializes a missing workstream goal before recording terminal worker evidence', () => {
    const controlGraph = createInitialAgentRunControlGraphState({ updatedAt: 100 });

    const { events, applied } = buildDelegationToolTerminalGraphEvents({
      toolName: 'sessions_spawn',
      resultContent: JSON.stringify({
        sessionId: 'sub-worker',
        status: 'completed',
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

  it('ignores non-terminal delegation tool results', () => {
    const controlGraph = createInitialAgentRunControlGraphState({ updatedAt: 100 });
    const { events, applied } = buildDelegationToolTerminalGraphEvents({
      toolName: 'sessions_spawn',
      resultContent: JSON.stringify({ status: 'running', sessionId: 'sub-worker' }),
      run: { controlGraph },
    });

    expect(applied).toBe(false);
    expect(events).toEqual([]);
  });
});
