import { reviewForegroundRunCompletion } from '../../../src/engine/graph/foregroundRun/completionReview';
import { useChatStore } from '../../../src/store/useChatStore';
import type { AgentRun } from '../../../src/types/agentRun';
import type { Message } from '../../../src/types/message';

function buildMessage(overrides: Partial<Message>): Message {
  return {
    id: 'msg-default',
    role: 'assistant',
    content: '',
    timestamp: 1,
    ...overrides,
  };
}

function buildRun(controlGraph: Partial<NonNullable<AgentRun['controlGraph']>> = {}): AgentRun {
  return {
    id: 'run-1',
    userMessageId: 'msg-user',
    goal: 'Compare official docs and return a short markdown table.',
    status: 'running',
    createdAt: 10,
    updatedAt: 50,
    currentPhase: 'review',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 2,
      startedTools: 1,
      completedTools: 1,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
    controlGraph: {
      version: 1,
      status: 'finalized',
      iteration: 2,
      expectedToolCalls: [],
      observedToolResults: [],
      pendingAsyncCount: 0,
      lastModelToolNames: [],
      audit: [],
      updatedAt: 50,
      ...controlGraph,
    } as never,
  } as AgentRun;
}

function seed(run: AgentRun, assistant: Partial<Message>): void {
  useChatStore.setState((state) => ({
    ...state,
    conversations: [
      {
        id: 'conversation-1',
        title: 'Review',
        messages: [
          buildMessage({ id: 'msg-user', role: 'user', content: 'Do the task.', timestamp: 10 }),
          buildMessage({ id: 'msg-assistant', timestamp: 50, ...assistant }),
        ],
        createdAt: 10,
        updatedAt: 50,
        logs: [],
        agentRuns: [run],
      } as never,
    ],
    activeConversationId: 'conversation-1',
  }));
}

function review(finalizeTrackedRun = jest.fn().mockReturnValue(true)) {
  const effects = {
    appendConversationLog: jest.fn(),
    finalizeTrackedRun,
    setChatError: jest.fn(),
    updateMessageAssistantMetadata: jest.fn(),
  };
  const result = reviewForegroundRunCompletion({
    ...effects,
    conversationId: 'conversation-1',
    runId: 'run-1',
    turnSummary: 'Turn summary',
  });
  return { result, effects };
}

describe('foregroundRun completion review', () => {
  it('completes with the final answer the agent loop delivered', () => {
    const finalAnswer = '| Feature | Responses | generateContent |';
    seed(buildRun(), {
      content: finalAnswer,
      assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
    });

    const { result, effects } = review();

    expect(result).toEqual(
      expect.objectContaining({
        handled: false,
        completionStatus: 'completed',
        latestSummary: finalAnswer,
        checkpointTitle: 'Final response delivered',
      }),
    );
    expect(effects.setChatError).not.toHaveBeenCalled();
  });

  it('ends a delivered approval rejection as a cancellation', () => {
    const notice = 'I did not send it because you rejected the approval request.';
    seed(buildRun({ status: 'cancelled', terminalReason: 'user_approval_denied' }), {
      content: notice,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'user_approval_denied',
      },
    });
    const finalizeTrackedRun = jest.fn().mockReturnValue(true);

    const { result } = review(finalizeTrackedRun);

    expect(result).toEqual({ handled: true, terminalized: true });
    expect(finalizeTrackedRun).toHaveBeenCalledWith(
      'cancelled',
      notice,
      'Run cancelled',
      notice,
      'user_cancelled',
    );
  });

  // A run that ended without an answer used to be resumed with its tools disabled and told to
  // "deliver the user-facing final answer now", or given an answer synthesized from its tool
  // results. It now fails with what it streamed and the error in view.
  it('fails a run that ended without an answer, keeping what it streamed', () => {
    seed(buildRun(), { content: 'Half of the table' });

    const { result, effects } = review();

    expect(result).toEqual(
      expect.objectContaining({
        handled: false,
        completionStatus: 'failed',
        latestSummary: 'Half of the table',
        checkpointTitle: 'Run ended without an answer',
      }),
    );
    expect(effects.updateMessageAssistantMetadata).toHaveBeenCalledWith(
      'conversation-1',
      'msg-assistant',
      expect.objectContaining({ completionStatus: 'incomplete', finishReason: 'response_failed' }),
    );
    expect(effects.setChatError).toHaveBeenCalledWith('The run ended without a final answer.');
  });
});
