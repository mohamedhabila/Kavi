import { buildRecoveredAgentRunStateAfterAppRestart } from '../../src/engine/graph/interruptedRunRecovery';
import {
  createInitialAgentRunControlGraphState,
  updateAgentRunControlGraphAsyncWorkState,
} from '../../src/services/agents/agentControlGraphState';
import type { AgentRun, AgentRunAsyncOperation } from '../../src/types/agentRun';
import type { Message } from '../../src/types/message';
import type { SubAgentSnapshot } from '../../src/types/subAgent';

function createPendingOperation(): AgentRunAsyncOperation {
  return {
    key: 'session:worker-1',
    kind: 'session',
    resourceId: 'worker-1',
    displayName: 'Worker 1',
    status: 'running',
    lastUpdatedByTool: 'sessions_spawn',
    updatedAt: 1_000,
    monitorToolNames: ['sessions_status', 'sessions_wait'],
    waitToolName: 'sessions_wait',
    waitArgs: { sessionId: 'worker-1' },
  };
}

function createRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    userMessageId: 'user-1',
    goal: 'Finish the task',
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    currentPhase: 'work',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 1,
      startedTools: 1,
      completedTools: 1,
      failedTools: 0,
      spawnedSubAgents: 1,
    },
    controlGraph: createInitialAgentRunControlGraphState({ updatedAt: 2 }),
    ...overrides,
  };
}

function createWorker(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'worker-1',
    parentConversationId: 'conv-1',
    depth: 0,
    startedAt: 1,
    updatedAt: 2,
    status: 'completed',
    sandboxPolicy: 'inherit',
    ...overrides,
  };
}

function createMessage(overrides: Partial<Message>): Message {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    ...overrides,
  };
}

describe('agent control graph interrupted run recovery', () => {
  it('keeps recovered async monitoring runs open in review from graph-owned pending operations', () => {
    const pendingOperation = createPendingOperation();
    const run = createRun({
      controlGraph: updateAgentRunControlGraphAsyncWorkState(
        createInitialAgentRunControlGraphState({ updatedAt: 2 }),
        {
          pendingOperations: [pendingOperation],
          updatedAt: 3,
        },
      ),
    });

    expect(
      buildRecoveredAgentRunStateAfterAppRestart({
        messages: [createMessage({ id: 'user-1', role: 'user', content: 'Run it' })],
        run,
        subAgents: [],
      }),
    ).toEqual({
      status: 'running',
      latestSummary:
        'Recovered 1 pending asynchronous operation after app restart. Resuming monitoring.',
      checkpointTitle: 'Recovered async workflow monitoring',
      checkpointDetail:
        'Recovered 1 pending asynchronous operation after app restart. Resuming monitoring.',
      phase: 'review',
    });
  });

  it('queues background review recovery when background workers ended unsuccessfully after restart', () => {
    const run = createRun({
      controlGraph: updateAgentRunControlGraphAsyncWorkState(
        createInitialAgentRunControlGraphState({ updatedAt: 2 }),
        {
          awaitingBackgroundWorkers: true,
          updatedAt: 3,
        },
      ),
    });

    expect(
      buildRecoveredAgentRunStateAfterAppRestart({
        messages: [createMessage({ id: 'user-1', role: 'user', content: 'Run it' })],
        run,
        subAgents: [createWorker({ status: 'error', output: 'worker failed normally' })],
      }),
    ).toEqual({
      status: 'running',
      latestSummary:
        'Background workers failed before the app restarted. Reopen the conversation to continue with a different approach if needed.',
      checkpointTitle: 'Recovered background failure',
      checkpointDetail:
        'Background workers failed before the app restarted. Reopen the conversation to continue with a different approach if needed.',
      awaitingBackgroundWorkers: true,
      phase: 'review',
    });
  });

  it('preserves a completed final assistant response when background work already finished', () => {
    const run = createRun({
      controlGraph: updateAgentRunControlGraphAsyncWorkState(
        createInitialAgentRunControlGraphState({ updatedAt: 2 }),
        {
          awaitingBackgroundWorkers: true,
          updatedAt: 3,
        },
      ),
    });
    const messages = [
      createMessage({ id: 'user-1', role: 'user', content: 'Run it', timestamp: 1 }),
      createMessage({
        id: 'assistant-final',
        role: 'assistant',
        content: 'Finished result.',
        timestamp: 2,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      }),
    ];

    expect(
      buildRecoveredAgentRunStateAfterAppRestart({
        messages,
        run,
        subAgents: [
          createWorker({
            status: 'completed',
            completionState: 'verified_success',
            output: 'Worker completed the delegated task.',
          }),
        ],
      }),
    ).toEqual({
      status: 'completed',
      latestSummary: 'Finished result.',
      checkpointTitle: 'Recovered background completion',
      checkpointDetail:
        'Background workers finished before the app restarted and the final response was preserved.',
    });
  });

  it('does nothing while a recovered worker is still actively running', () => {
    expect(
      buildRecoveredAgentRunStateAfterAppRestart({
        messages: [createMessage({ id: 'user-1', role: 'user', content: 'Run it' })],
        run: createRun(),
        subAgents: [createWorker({ status: 'running' })],
      }),
    ).toBeUndefined();
  });
});
