import { createAgentControlGraphRuntimeTerminal } from '../../src/engine/graph/agentControlGraphRuntimeTerminal';
import {
  createInitialAgentControlGraphSnapshot,
  reduceAgentControlGraph,
} from '../../src/engine/graph/agentControlGraph';
import { createGoal } from '../../src/engine/goals/types';
import { emitSessionEvent } from '../../src/services/events/bus';

jest.mock('../../src/services/events/bus', () => ({
  emitSessionEvent: jest.fn().mockResolvedValue(undefined),
}));

const mockedEmitSessionEvent = jest.mocked(emitSessionEvent);

function deliveryPendingSnapshot() {
  return createInitialAgentControlGraphSnapshot({
    goals: [
      {
        ...createGoal({
          id: 'done',
          title: 'Completed constrained goal',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.tool:read_file'],
          userConstraints: [{ text: 'Reply in Dutch.', sourceMessageId: 'user-1' }],
          now: 1,
        }),
        status: 'completed' as const,
        completedAt: 2,
        updatedAt: 2,
        userConstraintDeliveryPending: true,
      },
    ],
  });
}

function callbacks(onAssistantMessage = jest.fn()) {
  return {
    onAgentControlGraphStateChange: jest.fn(),
    onAssistantMessage,
    onStateChange: jest.fn(),
    onError: jest.fn(),
    onDone: jest.fn(),
  };
}

describe('agentControlGraphRuntimeTerminal', () => {
  beforeEach(() => {
    mockedEmitSessionEvent.mockReset();
    mockedEmitSessionEvent.mockResolvedValue(undefined);
  });

  it('delivers a clarification while leaving the graph nonterminal', async () => {
    let snapshot = createInitialAgentControlGraphSnapshot();
    const runtimeCallbacks = callbacks();
    const applyEvents = jest.fn((events) => {
      snapshot = reduceAgentControlGraph(snapshot, events);
      return snapshot;
    });
    const terminal = createAgentControlGraphRuntimeTerminal({
      callbacks: runtimeCallbacks,
      conversationId: 'conv-1',
      agentRunId: 'run-1',
      applyEvents,
    });

    await terminal.finishWaitingForUserInput({
      graphEvent: {
        type: 'USER_INPUT_REQUIRED',
        requestedAfterUserMessageId: 'user-1',
        requiredInformation: [{ key: 'alarm.time', requiredFor: 'execution' }],
      },
      content: 'What time should I use?',
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'request_clarification',
      },
      sessionEndReason: 'request_clarification',
    });

    expect(snapshot.status).toBe('awaiting_user');
    expect(runtimeCallbacks.onAssistantMessage).toHaveBeenCalledWith(
      'What time should I use?',
      [],
      undefined,
      expect.objectContaining({ finishReason: 'request_clarification' }),
    );
    expect(mockedEmitSessionEvent).toHaveBeenCalledWith('end', {
      conversationId: 'conv-1',
      reason: 'request_clarification',
      agentRunId: 'run-1',
    });
    expect(runtimeCallbacks.onDone).toHaveBeenCalledTimes(1);
  });

  it('rolls back a clarification wait when assistant delivery fails', async () => {
    let snapshot = createInitialAgentControlGraphSnapshot();
    const deliveryError = new Error('assistant persistence failed');
    const runtimeCallbacks = callbacks(
      jest.fn(() => {
        throw deliveryError;
      }),
    );
    const applyEvents = jest.fn((events) => {
      snapshot = reduceAgentControlGraph(snapshot, events);
      return snapshot;
    });
    const terminal = createAgentControlGraphRuntimeTerminal({
      callbacks: runtimeCallbacks,
      conversationId: 'conv-1',
      applyEvents,
    });

    await expect(
      terminal.finishWaitingForUserInput({
        graphEvent: {
          type: 'USER_INPUT_REQUIRED',
          requestedAfterUserMessageId: 'user-1',
          requiredInformation: [{ key: 'alarm.time', requiredFor: 'execution' }],
        },
        content: 'What time should I use?',
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'request_clarification',
        },
      }),
    ).rejects.toBe(deliveryError);

    expect(snapshot.status).toBe('ready');
    expect(snapshot.pendingUserInput).toBeUndefined();
    expect(snapshot.audit.at(-1)).toEqual(
      expect.objectContaining({
        type: 'USER_INPUT_WAIT_CANCELLED',
        detail: 'delivery_boundary_failed',
      }),
    );
    expect(runtimeCallbacks.onDone).not.toHaveBeenCalled();
  });

  it('warns and still completes failure callbacks when the terminal end event fails', async () => {
    const endEventError = new Error('event bus unavailable');
    const originalError = new Error('primary failure');
    mockedEmitSessionEvent.mockRejectedValueOnce(endEventError);
    const callbacks = {
      onAgentControlGraphStateChange: jest.fn(),
      onAssistantMessage: jest.fn(),
      onStateChange: jest.fn(),
      onError: jest.fn(),
      onDone: jest.fn(),
    };
    const warn = jest.fn();
    const applyEvents = jest.fn().mockReturnValue({ status: 'failed' });

    const terminal = createAgentControlGraphRuntimeTerminal({
      callbacks,
      conversationId: 'conv-1',
      applyEvents,
      warn,
    });

    await terminal.finishFailure(originalError);

    expect(applyEvents).toHaveBeenCalledWith([{ type: 'FAILED', reason: 'primary failure' }]);
    expect(callbacks.onStateChange).toHaveBeenCalledWith('error');
    expect(mockedEmitSessionEvent).toHaveBeenCalledWith('end', {
      conversationId: 'conv-1',
      reason: 'error',
    });
    expect(warn).toHaveBeenCalledWith(
      'Agent control graph session end event failed',
      endEventError,
    );
    expect(callbacks.onError).toHaveBeenCalledWith(originalError);
    expect(callbacks.onDone).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a settled final delivery in the same terminal transition', async () => {
    let snapshot = deliveryPendingSnapshot();
    const runtimeCallbacks = callbacks();
    const applyEvents = jest.fn((events) => {
      snapshot = reduceAgentControlGraph(snapshot, events);
      return snapshot;
    });
    const terminal = createAgentControlGraphRuntimeTerminal({
      callbacks: runtimeCallbacks,
      conversationId: 'conv-1',
      applyEvents,
    });

    await terminal.finishWithGraphTerminalEvent({
      graphEvent: { type: 'FINALIZED', reason: 'completed' },
      content: 'Klaar.',
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'graph_finalized',
      },
    });

    expect(applyEvents).toHaveBeenCalledWith([
      { type: 'USER_CONSTRAINT_DELIVERY_ACKNOWLEDGED' },
      { type: 'FINALIZED', reason: 'completed' },
    ]);
    expect(snapshot.status).toBe('finalized');
    expect(snapshot.goals?.[0]).not.toHaveProperty('userConstraintDeliveryPending');
    expect(snapshot.goals?.[0]).not.toHaveProperty('userConstraints');
    expect(snapshot.audit.at(-2)?.type).toBe('USER_CONSTRAINT_DELIVERY_ACKNOWLEDGED');
  });

  it('applies neither acknowledgement nor finalization when delivery persistence throws', async () => {
    let snapshot = deliveryPendingSnapshot();
    const deliveryError = new Error('assistant persistence failed');
    const runtimeCallbacks = callbacks(
      jest.fn(() => {
        throw deliveryError;
      }),
    );
    const applyEvents = jest.fn((events) => {
      snapshot = reduceAgentControlGraph(snapshot, events);
      return snapshot;
    });
    const terminal = createAgentControlGraphRuntimeTerminal({
      callbacks: runtimeCallbacks,
      conversationId: 'conv-1',
      applyEvents,
    });

    await expect(
      terminal.finishWithGraphTerminalEvent({
        graphEvent: { type: 'FINALIZED', reason: 'completed' },
        content: 'Klaar.',
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      }),
    ).rejects.toBe(deliveryError);
    expect(applyEvents).toHaveBeenNthCalledWith(1, [
      { type: 'FINAL_CANDIDATE_READY', reason: 'completed' },
    ]);
    expect(applyEvents).toHaveBeenNthCalledWith(2, [
      { type: 'FINAL_CANDIDATE_INVALIDATED', reason: 'delivery_boundary_failed' },
    ]);
    expect(snapshot.status).toBe('ready');
    expect(snapshot.goals?.[0]?.userConstraintDeliveryPending).toBe(true);
  });

  it('withdraws a terminal report when authority changes during graph staging', async () => {
    let snapshot = createInitialAgentControlGraphSnapshot();
    let deliveryAllowed = true;
    const runtimeCallbacks = callbacks();
    const applyEvents = jest.fn((events) => {
      snapshot = reduceAgentControlGraph(snapshot, events);
      if (events.some((event) => event.type === 'FINAL_CANDIDATE_READY')) {
        deliveryAllowed = false;
      }
      return snapshot;
    });
    const beforeAssistantDelivery = jest.fn(() => {
      if (!deliveryAllowed) {
        throw new Error('delivery_authority_revoked');
      }
    });
    const terminal = createAgentControlGraphRuntimeTerminal({
      callbacks: runtimeCallbacks,
      conversationId: 'conv-1',
      applyEvents,
    });

    await expect(
      terminal.finishWithGraphTerminalEvent({
        graphEvent: { type: 'BLOCKED', reason: 'provider_unavailable' },
        content: 'Memory-derived blocker',
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'response_failed',
        },
        beforeAssistantDelivery,
      }),
    ).rejects.toThrow('delivery_authority_revoked');

    expect(beforeAssistantDelivery).toHaveBeenCalledTimes(2);
    expect(runtimeCallbacks.onAssistantMessage).not.toHaveBeenCalled();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.audit.at(-1)?.type).toBe('FINAL_CANDIDATE_INVALIDATED');
    expect(runtimeCallbacks.onDone).not.toHaveBeenCalled();
  });

  it('withdraws an awaiting-review candidate when authority changes during graph publication', async () => {
    let snapshot = createInitialAgentControlGraphSnapshot();
    let deliveryAllowed = true;
    const runtimeCallbacks = callbacks();
    const applyEvents = jest.fn((events) => {
      snapshot = reduceAgentControlGraph(snapshot, events);
      if (events.some((event) => event.type === 'FINAL_CANDIDATE_READY')) {
        deliveryAllowed = false;
      }
      return snapshot;
    });
    const beforeAssistantDelivery = jest.fn(() => {
      if (!deliveryAllowed) {
        throw new Error('delivery_authority_revoked');
      }
    });
    const terminal = createAgentControlGraphRuntimeTerminal({
      callbacks: runtimeCallbacks,
      conversationId: 'conv-1',
      applyEvents,
    });

    await expect(
      terminal.finishWithGraphFinalCandidateEvent({
        graphEvent: { type: 'FINAL_CANDIDATE_READY', reason: 'completed' },
        content: 'Memory-derived candidate',
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
        beforeAssistantDelivery,
      }),
    ).rejects.toThrow('delivery_authority_revoked');

    expect(beforeAssistantDelivery).toHaveBeenCalledTimes(2);
    expect(runtimeCallbacks.onAssistantMessage).not.toHaveBeenCalled();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.audit.at(-1)).toEqual(
      expect.objectContaining({
        type: 'FINAL_CANDIDATE_INVALIDATED',
        detail: 'delivery_boundary_failed',
      }),
    );
    expect(runtimeCallbacks.onDone).not.toHaveBeenCalled();
  });

  it('withdraws a candidate when graph publication callbacks fail after reducing state', async () => {
    let snapshot = createInitialAgentControlGraphSnapshot();
    const publicationError = new Error('graph projection persistence failed');
    const runtimeCallbacks = callbacks();
    const applyEvents = jest.fn((events) => {
      snapshot = reduceAgentControlGraph(snapshot, events);
      if (events.some((event: { type: string }) => event.type === 'FINAL_CANDIDATE_READY')) {
        throw publicationError;
      }
      return snapshot;
    });
    const terminal = createAgentControlGraphRuntimeTerminal({
      callbacks: runtimeCallbacks,
      conversationId: 'conv-1',
      applyEvents,
    });

    await expect(
      terminal.finishWithGraphFinalCandidateEvent({
        graphEvent: { type: 'FINAL_CANDIDATE_READY', reason: 'completed' },
        content: 'Candidate',
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      }),
    ).rejects.toBe(publicationError);

    expect(runtimeCallbacks.onAssistantMessage).not.toHaveBeenCalled();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.audit.at(-1)?.type).toBe('FINAL_CANDIDATE_INVALIDATED');
  });

  it('does not terminalize a run when final delivery authority is already revoked', async () => {
    let snapshot = createInitialAgentControlGraphSnapshot();
    const runtimeCallbacks = callbacks();
    const terminal = createAgentControlGraphRuntimeTerminal({
      callbacks: runtimeCallbacks,
      conversationId: 'conv-1',
      applyEvents: (events) => {
        snapshot = reduceAgentControlGraph(snapshot, events);
        return snapshot;
      },
    });

    await expect(
      terminal.finishWithGraphTerminalEvent({
        graphEvent: { type: 'BLOCKED', reason: 'provider_unavailable' },
        content: 'Stale memory-derived blocker',
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'response_failed',
        },
        beforeAssistantDelivery: () => {
          throw new Error('delivery_authority_revoked');
        },
      }),
    ).rejects.toThrow('delivery_authority_revoked');

    expect(runtimeCallbacks.onAssistantMessage).not.toHaveBeenCalled();
    expect(snapshot.status).toBe('ready');
  });

  it.each([
    {
      label: 'incomplete metadata',
      graphEvent: { type: 'FINALIZED' as const, reason: 'completed' },
      content: 'Partial result',
      toolCalls: undefined,
      assistantMetadata: {
        kind: 'final' as const,
        completionStatus: 'incomplete' as const,
        finishReason: 'response_failed',
      },
    },
    {
      label: 'max iterations',
      graphEvent: { type: 'FINALIZED' as const, reason: 'max_iterations' },
      content: 'Iteration limit reached',
      toolCalls: undefined,
      assistantMetadata: {
        kind: 'final' as const,
        completionStatus: 'complete' as const,
        finishReason: 'max_iterations',
        terminalReason: 'max_iterations',
      },
    },
    {
      label: 'empty final text',
      graphEvent: { type: 'FINALIZED' as const, reason: 'completed' },
      content: ' ',
      toolCalls: undefined,
      assistantMetadata: {
        kind: 'final' as const,
        completionStatus: 'complete' as const,
        finishReason: 'stop',
      },
    },
    {
      label: 'tool-bearing response',
      graphEvent: { type: 'FINALIZED' as const, reason: 'completed' },
      content: 'Result',
      toolCalls: [{ id: 'tc-1', name: 'read_file', arguments: '{}', status: 'completed' as const }],
      assistantMetadata: {
        kind: 'final' as const,
        completionStatus: 'complete' as const,
        finishReason: 'stop',
      },
    },
  ])('preserves pending delivery for $label', async (entry) => {
    let snapshot = deliveryPendingSnapshot();
    const terminal = createAgentControlGraphRuntimeTerminal({
      callbacks: callbacks(),
      conversationId: 'conv-1',
      applyEvents: (events) => {
        snapshot = reduceAgentControlGraph(snapshot, events);
        return snapshot;
      },
    });

    await terminal.finishWithGraphTerminalEvent({
      graphEvent: entry.graphEvent,
      content: entry.content,
      toolCalls: entry.toolCalls,
      assistantMetadata: entry.assistantMetadata,
    });

    expect(snapshot.goals?.[0]?.userConstraintDeliveryPending).toBe(true);
  });
});
