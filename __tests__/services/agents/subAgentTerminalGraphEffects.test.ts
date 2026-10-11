import type { AgentRun } from '../../../src/types/agentRun';
import type { SubAgentSnapshot } from '../../../src/types/subAgent';
import { reduceAgentControlGraph } from '../../../src/engine/graph/agentControlGraph';
import { createInitialAgentRunControlGraphState } from '../../../src/services/agents/agentControlGraphState';
import {
  applySubAgentTerminalControlGraphEffects,
  buildSubAgentTerminalControlGraphEvents,
} from '../../../src/services/agents/subAgentTerminalGraphEffects';

function buildWorker(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'sub-1',
    parentConversationId: 'conv-1',
    depth: 1,
    startedAt: 10,
    updatedAt: 20,
    status: 'completed',
    completionState: 'verified_success',
    sandboxPolicy: 'inherit',
    launchState: 'terminal',
    output: 'Verified worker findings.',
    workstreamId: 'delegated-workstream',
    ...overrides,
  };
}

function waitingRun(): AgentRun {
  const controlGraph = reduceAgentControlGraph(
    createInitialAgentRunControlGraphState({ updatedAt: 100 }),
    [
      {
        type: 'ASYNC_WAITING',
        pendingAsyncCount: 2,
        pendingOperations: ['sub-1', 'sub-2'].map((sessionId) => ({
          key: `session:${sessionId}`,
          kind: 'session' as const,
          resourceId: sessionId,
          displayName: `Session ${sessionId}`,
          status: 'running' as const,
          blocksFinalization: false,
          lastUpdatedByTool: 'sessions_spawn',
          updatedAt: 100,
          monitorToolNames: ['sessions_wait'],
          waitToolName: 'sessions_wait',
          waitArgs: { sessionId },
        })),
        awaitingBackgroundWorkers: true,
        timestamp: 100,
      },
    ],
  );
  return { id: 'run-1', status: 'running', createdAt: 1, updatedAt: 1, controlGraph } as AgentRun;
}

describe('sub-agent terminal graph effects', () => {
  it("drops a finished worker's pending operation and keeps its siblings", () => {
    const nextGraph = applySubAgentTerminalControlGraphEffects({
      run: waitingRun(),
      agent: buildWorker(),
      event: 'completed',
      timestamp: 200,
    });

    expect(nextGraph?.asyncWork.pendingOperations.map((operation) => operation.resourceId)).toEqual(
      ['sub-2'],
    );
    expect(nextGraph?.goals ?? []).toEqual([]);
  });

  it('records nothing for a worker that only started', () => {
    expect(
      buildSubAgentTerminalControlGraphEvents({
        run: waitingRun(),
        agent: buildWorker({ status: 'running' }),
        event: 'started',
      }),
    ).toEqual([]);
  });

  it('releases the run the same way whatever state the worker ended in', () => {
    for (const completionState of ['incomplete', 'blocked'] as const) {
      const nextGraph = applySubAgentTerminalControlGraphEffects({
        run: waitingRun(),
        agent: buildWorker({ completionState }),
        event: 'completed',
        timestamp: 200,
      });
      expect(nextGraph?.asyncWork.pendingOperations).toHaveLength(1);
    }
  });
});
