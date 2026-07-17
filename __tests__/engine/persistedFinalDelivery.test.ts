import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { createGoal } from '../../src/engine/goals/types';
import {
  buildAgentControlGraphAfterPersistedFinalDelivery,
  inspectPersistedAgentRunFinalDelivery,
} from '../../src/engine/graph/persistedFinalDelivery';
import type {
  AgentRun,
  AgentRunAsyncOperation,
  AgentRunControlGraphState,
  AgentRunControlGraphStatus,
} from '../../src/types/agentRun';
import type { Message } from '../../src/types/message';

const messages: Message[] = [
  { id: 'user-1', role: 'user', content: 'Finish the task.', timestamp: 1 },
  {
    id: 'final-1',
    role: 'assistant',
    content: 'The verified result is ready.',
    timestamp: 2,
    assistantMetadata: {
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'stop',
    },
  },
];

function pendingOperation(): AgentRunAsyncOperation {
  return {
    key: 'session:worker-1',
    kind: 'session',
    resourceId: 'worker-1',
    displayName: 'Worker 1',
    status: 'running',
    lastUpdatedByTool: 'sessions_spawn',
    updatedAt: 2,
    monitorToolNames: ['sessions_status'],
  };
}

function graph(
  status: AgentRunControlGraphStatus,
  overrides: Partial<AgentRunControlGraphState> = {},
): AgentRunControlGraphState {
  return createInitialAgentControlGraphSnapshot({
    status,
    updatedAt: 2,
    ...overrides,
  });
}

function run(controlGraph: AgentRunControlGraphState): Pick<
  AgentRun,
  'controlGraph' | 'createdAt' | 'userMessageId'
> {
  return {
    userMessageId: 'user-1',
    createdAt: 1,
    controlGraph,
  };
}

function reconcile(controlGraph: AgentRunControlGraphState) {
  return buildAgentControlGraphAfterPersistedFinalDelivery({
    messages,
    run: run(controlGraph),
  });
}

describe('persisted final delivery graph boundary', () => {
  it('does not use an older final while a newer model turn is in flight', () => {
    const modelTurnGraph = graph('model_turn');

    expect(
      inspectPersistedAgentRunFinalDelivery({ messages, run: run(modelTurnGraph) }),
    ).toEqual({ state: 'unsafe_boundary' });
    expect(reconcile(modelTurnGraph)).toBeUndefined();
  });

  it('does not finalize while tool results are still outstanding', () => {
    expect(
      reconcile(
        graph('awaiting_tool_results', {
          expectedToolCalls: [{ id: 'call-1', name: 'read_file' }],
          observedToolResults: [],
        }),
      ),
    ).toBeUndefined();
  });

  it('does not finalize from a waiting async state with a pending operation', () => {
    expect(
      reconcile(
        graph('waiting_async', {
          pendingAsyncCount: 1,
          asyncWork: {
            awaitingBackgroundWorkers: false,
            pendingOperations: [pendingOperation()],
            updatedAt: 2,
          },
        }),
      ),
    ).toBeUndefined();
  });

  it('does not finalize from recovery even when a final message is persisted', () => {
    expect(
      reconcile(
        graph('recovering', {
          finalizationHoldReason: 'tool effect reconciliation is still in progress',
        }),
      ),
    ).toBeUndefined();
  });

  it.each([
    [
      'an in-flight tool boundary',
      {
        expectedToolCalls: [{ id: 'call-1', name: 'read_file' }],
        observedToolResults: [],
      },
    ],
    [
      'a pending asynchronous operation',
      {
        pendingAsyncCount: 1,
        asyncWork: {
          awaitingBackgroundWorkers: false,
          pendingOperations: [pendingOperation()],
          updatedAt: 2,
        },
      },
    ],
    [
      'pending background workers',
      {
        asyncWork: {
          awaitingBackgroundWorkers: true,
          pendingOperations: [],
          updatedAt: 2,
        },
      },
    ],
  ] as const)('rejects an awaiting-review graph that still has %s', (_label, overrides) => {
    expect(
      reconcile(graph('awaiting_review', overrides as Partial<AgentRunControlGraphState>)),
    ).toBeUndefined();
  });

  it('finalizes a quiescent awaiting-review graph', () => {
    const reconciled = reconcile(graph('awaiting_review'));

    expect(reconciled).toMatchObject({ status: 'finalized', terminalReason: 'completed' });
    expect(reconciled?.audit.at(-1)?.type).toBe('FINALIZED');
  });

  it('returns an already-finalized quiescent graph unchanged', () => {
    const finalized = graph('finalized', { terminalReason: 'completed' });

    expect(reconcile(finalized)).toBe(finalized);
  });

  it('acknowledges a persisted constraint obligation on an already-finalized graph', () => {
    const constrainedGoal = {
      ...createGoal({
        id: 'deliver',
        title: 'Deliver the verified result',
        status: 'active',
        completionPolicy: 'blocking',
        successCriteria: ['evidence.tool:read_file'],
        userConstraints: [{ text: 'Reply in Dutch.', sourceMessageId: 'user-1' }],
        now: 1,
      }),
      status: 'completed' as const,
      updatedAt: 2,
      completedAt: 2,
      userConstraintDeliveryPending: true as const,
    };
    const reconciled = reconcile(
      graph('finalized', {
        terminalReason: 'completed',
        goals: [constrainedGoal],
      }),
    );

    expect(reconciled?.status).toBe('finalized');
    expect(reconciled?.goals?.[0]).not.toHaveProperty('userConstraints');
    expect(reconciled?.goals?.[0]).not.toHaveProperty('userConstraintDeliveryPending');
    expect(reconciled?.audit.slice(-2).map((event) => event.type)).toEqual([
      'USER_CONSTRAINT_DELIVERY_ACKNOWLEDGED',
      'FINALIZED',
    ]);
  });
});
