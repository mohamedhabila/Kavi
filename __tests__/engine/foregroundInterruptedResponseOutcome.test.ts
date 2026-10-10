import { resolveForegroundInterruptedResponseOutcome } from '../../src/engine/graph/foregroundRun/foregroundInterruptedResponse';

let mockCurrentConversation: any;

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: { getState: () => ({ conversations: [mockCurrentConversation] }) },
}));

jest.mock('../../src/services/agents/agentRunAsyncState', () => ({
  getAgentRunPendingAsyncOperations: jest.fn(() => []),
}));

jest.mock('../../src/services/agents/subAgentRunTracking', () => ({
  getReviewableSubAgentsForRun: jest.fn(() => ({
    liveSnapshots: [],
    mergedSnapshots: [],
    hasOrphanedRunningSnapshots: false,
  })),
}));

jest.mock('../../src/services/agents/lifecycle/finalizePhase', () => ({
  collectAgentRunFinalizationEvidence: jest.fn(() => ({
    hasIncompleteToolCalls: false,
    lastNonEmptyAssistantContent: 'Verified result',
    lastSubstantiveResult: 'Verified result',
    resultPreviews: [],
  })),
  hasCompletedExecutionRecoveryEvidence: jest.fn(() => true),
}));

function seedInterruptedRun(): void {
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
        summary: { startedTools: 1 },
        controlGraph: { iteration: 1 },
      },
    ],
  };
}

describe('a foreground response interrupted after the work was verified', () => {
  it('is recovered from that work, whatever the run planned', async () => {
    seedInterruptedRun();

    const outcome = await resolveForegroundInterruptedResponseOutcome({
      assertNotAborted: jest.fn(),
      conversationId: mockCurrentConversation.id,
      error: new Error('stream interrupted'),
      finalizationProviderContext: {} as never,
      runId: 'run-1',
      signal: new AbortController().signal,
    });

    expect(outcome).toEqual({
      status: 'completed',
      checkpointTitle: 'Response recovered',
      checkpointDetail: 'Interrupted stream recovered from the verified work.',
    });
  });
});
