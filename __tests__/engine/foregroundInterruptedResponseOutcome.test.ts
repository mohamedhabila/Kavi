import { resolveForegroundInterruptedResponseOutcome } from '../../src/engine/graph/foregroundRun/foregroundInterruptedResponse';
import { getAgentRunPendingAsyncOperations } from '../../src/services/agents/agentRunAsyncState';

let mockCurrentConversation: any;

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: { getState: () => ({ conversations: [mockCurrentConversation] }) },
}));

jest.mock('../../src/services/agents/agentRunAsyncState', () => ({
  getAgentRunPendingAsyncOperations: jest.fn(() => []),
}));

const mockedPendingOperations = jest.mocked(getAgentRunPendingAsyncOperations);

function seedRunWithFinishedToolWork(): void {
  mockCurrentConversation = {
    id: 'conversation-1',
    messages: [{ id: 'user-1', role: 'user', content: 'Finish it', timestamp: 1 }],
    agentRuns: [
      {
        id: 'run-1',
        userMessageId: 'user-1',
        goal: 'Finish it',
        status: 'running',
        createdAt: 1,
        updatedAt: 2,
        summary: { startedTools: 3, completedTools: 3 },
        controlGraph: { iteration: 4 },
      },
    ],
  };
}

function interrupt(error: Error = new TypeError('terminated')) {
  return resolveForegroundInterruptedResponseOutcome({
    conversationId: 'conversation-1',
    error,
    runId: 'run-1',
  });
}

describe('a foreground response interrupted after its tools ran', () => {
  beforeEach(() => {
    seedRunWithFinishedToolWork();
    mockedPendingOperations.mockReturnValue([]);
  });

  it('fails, whatever work it finished', () => {
    expect(interrupt()).toEqual({
      status: 'failed',
      checkpointTitle: 'Turn failed',
      checkpointDetail: 'terminated',
    });
  });

  it('stays open while one of its async operations is still pending', () => {
    mockedPendingOperations.mockReturnValue([
      {
        key: 'session:s1',
        kind: 'session',
        resourceId: 's1',
        displayName: 'Worker session',
        status: 'running',
        lastUpdatedByTool: 'sessions_spawn',
        updatedAt: 1000,
        monitorToolNames: ['sessions_status'],
        waitToolName: 'sessions_wait',
      },
    ]);

    expect(interrupt()).toEqual(
      expect.objectContaining({ status: 'failed', keepRunOpen: 'async-operations' }),
    );
  });

  it('names a provider rejection as such', () => {
    const rejected = new Error(
      'LLM API error 400 invalid_request_error: tool_result blocks must follow tool_use blocks',
    );

    expect(interrupt(rejected)).toEqual(
      expect.objectContaining({ status: 'failed', checkpointTitle: 'Provider request rejected' }),
    );
  });
});
