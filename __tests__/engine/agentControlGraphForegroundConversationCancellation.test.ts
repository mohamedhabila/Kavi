import {
  rewindForegroundConversationRun,
  selectForegroundSupersededRun,
  stopForegroundConversationRuns,
  supersedeForegroundConversationRun,
} from '../../src/engine/graph/foregroundConversationCancellation';
import {
  __resetAgentRunCancellationRegistryForTests,
  createAgentRunOperationController,
} from '../../src/services/agents/agentRunCancellation';
import type { Conversation } from '../../src/types/conversation';

describe('foregroundConversationCancellation', () => {
  afterEach(() => {
    __resetAgentRunCancellationRegistryForTests();
  });

  it('selects the active running run as superseded when no reuse run is active', () => {
    const conversation: Conversation = {
      id: 'conv1',
      title: 'Test',
      messages: [],
      providerId: 'openai',
      createdAt: 1,
      updatedAt: 1,
      activeAgentRunId: 'run-1',
      usage: {
        entries: [],
        totalInput: 0,
        totalOutput: 0,
        totalCost: 0,
      },
      agentRuns: [
        {
          id: 'run-1',
          userMessageId: 'msg-1',
          goal: 'finish prior task',
          status: 'running',
          createdAt: 1,
          updatedAt: 1,
          currentPhase: 'work',
          phases: [],
          checkpoints: [],
          summary: {
            assistantTurns: 0,
            startedTools: 0,
            completedTools: 0,
            failedTools: 0,
            spawnedSubAgents: 0,
          },
        },
      ],
    };

    const result = selectForegroundSupersededRun({ conversation });

    expect(result.existingRun).toBeUndefined();
    expect(result.supersededRun?.id).toBe('run-1');
    expect(result.supersededRunningWorkerCount).toBe(0);
  });

  it('rewinds the active run and cancels the foreground request', () => {
    const abortForegroundRequestForConversation = jest.fn();
    const clearPendingRunState = jest.fn();

    rewindForegroundConversationRun({
      abortForegroundRequestForConversation,
      clearPendingRunState,
      conversation: {
        id: 'conv1',
        title: 'Test',
        messages: [],
        providerId: 'openai',
        createdAt: 1,
        updatedAt: 1,
        activeAgentRunId: 'run-1',
        usage: {
          entries: [],
          totalInput: 0,
          totalOutput: 0,
          totalCost: 0,
        },
        agentRuns: [],
      },
      conversationId: 'conv1',
      reason: 'rewind reason',
    });

    expect(abortForegroundRequestForConversation).toHaveBeenCalledWith('conv1', 'rewind reason');
    expect(clearPendingRunState).toHaveBeenCalledWith('conv1', 'run-1');
  });

  it('fences owned operations before awaiting durable cancellation or applying completion', async () => {
    const appendConversationLog = jest.fn();
    const clearForegroundRequestForConversation = jest.fn();
    const clearPendingRunState = jest.fn();
    const completeAgentRun = jest.fn();
    const ensureAgentRunFinalResponse = jest.fn().mockResolvedValue(undefined);
    const updateAgentRunControlGraph = jest.fn();
    const abortForegroundRequestForConversation = jest.fn();
    const conversation: Conversation = {
      id: 'conv1',
      title: 'Test',
      messages: [],
      providerId: 'openai',
      createdAt: 1,
      updatedAt: 1,
      activeAgentRunId: 'run-1',
      usage: {
        entries: [],
        totalInput: 0,
        totalOutput: 0,
        totalCost: 0,
      },
      agentRuns: [
        {
          id: 'run-1',
          userMessageId: 'msg-1',
          goal: 'finish prior task',
          status: 'running',
          createdAt: 1,
          updatedAt: 1,
          currentPhase: 'work',
          phases: [],
          checkpoints: [],
          summary: {
            assistantTurns: 0,
            startedTools: 0,
            completedTools: 0,
            failedTools: 0,
            spawnedSubAgents: 0,
          },
        },
      ],
    };

    supersedeForegroundConversationRun({
      actions: {
        appendConversationLog,
        clearForegroundRequestForConversation,
        clearPendingRunState,
        completeAgentRun,
        ensureAgentRunFinalResponse,
        getLatestConversation: () => conversation,
        updateAgentRunControlGraph,
      },
      conversation,
      conversationId: 'conv1',
      runId: 'run-1',
      runningWorkerCount: 0,
    });

    expect(clearPendingRunState).toHaveBeenCalledWith('conv1', 'run-1');
    expect(completeAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        checkpointTitle: 'Run superseded',
        status: 'cancelled',
      }),
      'run-1',
    );

    completeAgentRun.mockClear();
    const order: string[] = [];
    const ownedOperation = createAgentRunOperationController({
      conversationId: 'conv1',
      runId: 'run-1',
      operationId: 'operation-1',
    });
    let releaseDurableCancellation: (() => void) | undefined;
    const durableCancellationGate = new Promise<void>((resolve) => {
      releaseDurableCancellation = resolve;
    });
    completeAgentRun.mockImplementation(() => {
      order.push('visible-terminal');
    });
    const stopPromise = stopForegroundConversationRuns({
      abortForegroundRequestForConversation,
      actions: {
        appendConversationLog,
        clearForegroundRequestForConversation,
        clearPendingRunState,
        completeAgentRun,
        ensureAgentRunFinalResponse,
        getLatestConversation: () => conversation,
        updateAgentRunControlGraph,
      },
      cancelOwnedRecoveries: jest.fn(async () => {
        order.push('journal-cancellation-started');
        await durableCancellationGate;
        order.push('journal-and-native-cancelled');
        return {
          cancelledRunCount: 1,
          settledRunCount: 0,
          issues: [{ kind: 'deferred', reason: 'native_bridge_unavailable', count: 1 }],
        };
      }),
      conversation,
      conversationId: 'conv1',
    });

    expect(ownedOperation.signal.aborted).toBe(true);
    expect(order).toEqual([]);

    await Promise.resolve();
    expect(order).toEqual(['journal-cancellation-started']);
    expect(completeAgentRun).not.toHaveBeenCalled();

    releaseDurableCancellation?.();
    await stopPromise;
    ownedOperation.dispose();

    expect(abortForegroundRequestForConversation).toHaveBeenCalledWith(
      'conv1',
      'Cancelled because the supervising turn was stopped by the user.',
    );
    expect(clearForegroundRequestForConversation).toHaveBeenCalledWith('conv1');
    expect(order).toEqual([
      'journal-cancellation-started',
      'journal-and-native-cancelled',
      'visible-terminal',
    ]);
    expect(appendConversationLog).toHaveBeenCalledWith('conv1', {
      kind: 'error',
      level: 'warning',
      title: 'Durable cancellation needs attention',
      detail: '1 deferred: native_bridge_unavailable',
    });
    expect(appendConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: 'Generation stopped',
      }),
    );
  });

  it('does not report supersession after another path already completed the run', () => {
    const appendConversationLog = jest.fn();
    const completedConversation = {
      id: 'conv1',
      title: 'Test',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
      agentRuns: [
        {
          id: 'run-1',
          userMessageId: 'user-1',
          goal: 'Finish',
          status: 'completed',
          createdAt: 1,
          updatedAt: 2,
          currentPhase: 'deliver',
          phases: [],
          checkpoints: [],
          summary: {
            assistantTurns: 1,
            startedTools: 0,
            completedTools: 0,
            failedTools: 0,
            spawnedSubAgents: 0,
          },
        },
      ],
    } as Conversation;

    supersedeForegroundConversationRun({
      actions: {
        appendConversationLog,
        clearPendingRunState: jest.fn(),
        completeAgentRun: jest.fn(),
        getLatestConversation: () => completedConversation,
        updateAgentRunControlGraph: jest.fn(),
      },
      conversation: completedConversation,
      conversationId: completedConversation.id,
      runId: 'run-1',
      runningWorkerCount: 0,
    });

    expect(appendConversationLog).not.toHaveBeenCalled();
  });

  it('does not generate or report cancellation after completion wins the durable wait race', async () => {
    const initialConversation = {
      id: 'conv1',
      title: 'Test',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      activeAgentRunId: 'run-1',
      agentRuns: [
        {
          id: 'run-1',
          userMessageId: 'user-1',
          goal: 'Finish',
          status: 'running',
          createdAt: 1,
          updatedAt: 1,
          currentPhase: 'work',
          phases: [],
          checkpoints: [],
          summary: {
            assistantTurns: 0,
            startedTools: 0,
            completedTools: 0,
            failedTools: 0,
            spawnedSubAgents: 0,
          },
        },
      ],
    } as Conversation;
    let latestConversation = initialConversation;
    const appendConversationLog = jest.fn();
    const ensureAgentRunFinalResponse = jest.fn();

    await stopForegroundConversationRuns({
      abortForegroundRequestForConversation: jest.fn(() => true),
      actions: {
        appendConversationLog,
        clearPendingRunState: jest.fn(),
        completeAgentRun: jest.fn(),
        ensureAgentRunFinalResponse,
        getLatestConversation: () => latestConversation,
        updateAgentRunControlGraph: jest.fn(),
      },
      cancelOwnedRecoveries: jest.fn(async () => {
        latestConversation = {
          ...initialConversation,
          agentRuns: initialConversation.agentRuns?.map((run) => ({
            ...run,
            status: 'completed' as const,
          })),
        };
        return { cancelledRunCount: 0, settledRunCount: 0, issues: [] };
      }),
      conversation: initialConversation,
      conversationId: initialConversation.id,
    });

    expect(ensureAgentRunFinalResponse).not.toHaveBeenCalled();
    expect(appendConversationLog).not.toHaveBeenCalledWith(
      initialConversation.id,
      expect.objectContaining({ title: expect.stringContaining('stopped') }),
    );
  });
});
