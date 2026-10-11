import { reduceAgentControlGraph } from '../../src/engine/graph/agentControlGraph';
import { buildDelegationToolTerminalGraphEvents } from '../../src/engine/graph/delegationToolTerminalGraphEffects';
import { createInitialAgentRunControlGraphState } from '../../src/services/agents/agentControlGraphState';

function pending(sessionId: string) {
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
    statusArgs: { sessionId },
    waitArgs: { sessionId },
  };
}

function waitingGraph(sessionIds: string[]) {
  return reduceAgentControlGraph(createInitialAgentRunControlGraphState({ updatedAt: 100 }), [
    {
      type: 'ASYNC_WAITING',
      pendingAsyncCount: sessionIds.length,
      pendingOperations: sessionIds.map(pending),
      timestamp: 100,
    },
  ]);
}

function terminalSession(sessionId: string, overrides: Record<string, unknown> = {}) {
  return {
    sessionId,
    status: 'completed',
    terminationCause: 'completed',
    completionState: 'verified_success',
    output: `Result from ${sessionId}.`,
    toolsUsed: [],
    iterations: 1,
    depth: 1,
    ...overrides,
  };
}

function pendingAfter(events: ReturnType<typeof buildDelegationToolTerminalGraphEvents>) {
  const last = events.filter((event) => event.type === 'ASYNC_WAITING').at(-1);
  return last && 'pendingOperations' in last
    ? (last.pendingOperations ?? []).map((operation) => operation.resourceId)
    : undefined;
}

describe('delegation tool results release the workers they observed', () => {
  it('clears every worker a sessions_wait collected from pending work', () => {
    const events = buildDelegationToolTerminalGraphEvents({
      toolName: 'sessions_wait',
      resultContent: JSON.stringify({
        status: 'completed',
        sessions: [terminalSession('sub-1'), terminalSession('sub-2')],
      }),
      run: { controlGraph: waitingGraph(['sub-1', 'sub-2', 'sub-3']) },
      timestamp: 200,
    });

    expect(pendingAfter(events)).toEqual(['sub-3']);
    expect(events.every((event) => event.type === 'ASYNC_WAITING')).toBe(true);
  });

  it('releases a worker whatever state it ended in', () => {
    const events = buildDelegationToolTerminalGraphEvents({
      toolName: 'sessions_spawn',
      resultContent: JSON.stringify(
        terminalSession('sub-1', { status: 'blocked', completionState: 'blocked' }),
      ),
      run: { controlGraph: waitingGraph(['sub-1']) },
    });

    expect(pendingAfter(events)).toEqual([]);
  });

  it('records nothing for a worker that is still running', () => {
    expect(
      buildDelegationToolTerminalGraphEvents({
        toolName: 'sessions_spawn',
        resultContent: JSON.stringify({ status: 'running', sessionId: 'sub-1' }),
        run: { controlGraph: waitingGraph(['sub-1']) },
      }),
    ).toEqual([]);
  });

  it('reads terminal workers from compact spill metadata', () => {
    const events = buildDelegationToolTerminalGraphEvents({
      toolName: 'sessions_wait',
      resultContent: JSON.stringify({
        status: 'spilled',
        path: '.kavi/spill/sessions_wait-1.txt',
        structuralResult: {
          version: 1,
          kind: 'delegation_sessions',
          sessions: [{ ...terminalSession('sub-1'), output: undefined, outputPreview: 'Done.' }],
        },
      }),
      run: { controlGraph: waitingGraph(['sub-1']) },
    });

    expect(pendingAfter(events)).toEqual([]);
  });

  it('ignores other tools and results that are not JSON', () => {
    const controlGraph = waitingGraph(['sub-1']);
    expect(
      buildDelegationToolTerminalGraphEvents({
        toolName: 'read_file',
        resultContent: JSON.stringify(terminalSession('sub-1')),
        run: { controlGraph },
      }),
    ).toEqual([]);
    expect(
      buildDelegationToolTerminalGraphEvents({
        toolName: 'sessions_wait',
        resultContent: 'not json',
        run: { controlGraph },
      }),
    ).toEqual([]);
  });
});
