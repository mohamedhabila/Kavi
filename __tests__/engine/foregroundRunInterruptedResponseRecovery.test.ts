import { handleForegroundInterruptedResponseRecovery } from '../../src/engine/graph/foregroundRun/interruptedResponseRecovery';
import type { AgentControlGraphInterruptedResponseOutcome } from '../../src/engine/graph/interruptedResponseRecovery';

const TURN_FAILED: AgentControlGraphInterruptedResponseOutcome = {
  status: 'failed',
  checkpointTitle: 'Turn failed',
  checkpointDetail: 'stream interrupted',
};

function handle(params: {
  outcome?: AgentControlGraphInterruptedResponseOutcome;
  finalizeTrackedRun?: jest.Mock;
  recovered?: { preview?: string; recovered: boolean; delivered: boolean };
}) {
  const effects = {
    appendConversationLog: jest.fn(),
    finalizeTrackedRun: params.finalizeTrackedRun ?? jest.fn(() => true),
    recoverAgentRunFinalPreview: jest.fn(
      async () => params.recovered ?? { recovered: false, delivered: false },
    ),
    requestPersistenceCheckpoint: jest.fn(),
    setAgentRunPhase: jest.fn(),
    setChatError: jest.fn(),
    updateAgentRunSummary: jest.fn(),
    updateMessage: jest.fn(),
    updateMessageAssistantMetadata: jest.fn(),
  };
  const done = handleForegroundInterruptedResponseRecovery({
    ...effects,
    assertNotAborted: jest.fn(),
    conversationId: 'conversation-1',
    currentAssistantMessageId: 'assistant-1',
    errorMessage: 'stream interrupted',
    outcome: params.outcome ?? TURN_FAILED,
    runId: 'run-1',
    signal: new AbortController().signal,
    visibleContent: 'Partial answer',
  });
  return { done, effects };
}

describe('foreground interrupted response recovery', () => {
  it('fails the run, keeps what streamed, and shows the error', async () => {
    const { done, effects } = handle({});
    await done;

    expect(effects.finalizeTrackedRun).toHaveBeenCalledWith(
      'failed',
      'Partial answer',
      'Turn failed',
      'stream interrupted',
    );
    expect(effects.setChatError).toHaveBeenCalledWith('stream interrupted');
    expect(effects.updateMessage).toHaveBeenCalledWith(
      'conversation-1',
      'assistant-1',
      'Partial answer',
    );
    expect(effects.updateMessageAssistantMetadata).toHaveBeenCalledWith(
      'conversation-1',
      'assistant-1',
      expect.objectContaining({ completionStatus: 'incomplete', finishReason: 'response_failed' }),
    );
    expect(effects.requestPersistenceCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('keeps a run waiting on async operations open in its work phase', async () => {
    const { done, effects } = handle({
      outcome: {
        status: 'failed',
        keepRunOpen: 'async-operations',
        checkpointTitle: 'Async monitoring active',
        checkpointDetail: 'Waiting for Deploy run to finish.',
      },
    });
    await done;

    expect(effects.finalizeTrackedRun).not.toHaveBeenCalled();
    expect(effects.setAgentRunPhase).toHaveBeenCalledWith(
      'conversation-1',
      'work',
      expect.objectContaining({ status: 'active', checkpointTitle: 'Async monitoring active' }),
      'run-1',
    );
    expect(effects.setChatError).not.toHaveBeenCalled();
  });

  it('holds the run for review when the graph refuses to terminalize it', async () => {
    const { done, effects } = handle({ finalizeTrackedRun: jest.fn(() => false) });
    await done;

    expect(effects.setAgentRunPhase).toHaveBeenCalledWith(
      'conversation-1',
      'review',
      expect.objectContaining({ checkpointTitle: 'Run terminalization recovery pending' }),
      'run-1',
    );
    expect(effects.setChatError).not.toHaveBeenCalled();
    expect(effects.updateMessage).not.toHaveBeenCalled();
  });
});
