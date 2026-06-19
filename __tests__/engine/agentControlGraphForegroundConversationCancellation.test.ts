import {
  rewindForegroundConversationRun,
  selectForegroundSupersededRun,
  stopForegroundConversationRuns,
  supersedeForegroundConversationRun,
} from '../../src/engine/graph/foregroundConversationCancellation';
import type { Conversation } from '../../src/types/conversation';

describe('foregroundConversationCancellation', () => {
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
    expect(clearPendingRunState).toHaveBeenCalledWith('run-1');
  });

  it('builds and applies stop/supersede effects through shared completion actions', () => {
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

    expect(clearPendingRunState).toHaveBeenCalledWith('run-1');
    expect(completeAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        checkpointTitle: 'Run superseded',
        status: 'cancelled',
      }),
      'run-1',
    );

    stopForegroundConversationRuns({
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
      conversation,
      conversationId: 'conv1',
    });

    expect(abortForegroundRequestForConversation).toHaveBeenCalledWith(
      'conv1',
      'Cancelled because the supervising turn was stopped by the user.',
    );
    expect(clearForegroundRequestForConversation).toHaveBeenCalledWith('conv1');
    expect(appendConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: 'Generation stopped',
      }),
    );
  });
});
