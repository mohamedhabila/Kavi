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

function seedGoal(goal: Record<string, unknown>): void {
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
        controlGraph: { iteration: 1, goals: [goal] },
      },
    ],
  };
}

describe('foreground interrupted response goal state', () => {
  it.each(['user_constraint_state_conflict', 'goal_evidence_incomplete'])(
    'fails instead of completing or resuming a blocked required goal (%s)',
    async (blockedReason) => {
      seedGoal({
        id: 'required',
        title: 'Required result',
        status: 'blocked',
        dependencies: [],
        evidence: [],
        successCriteria: ['evidence.tool:read_file'],
        completionPolicy: 'blocking',
        blockedReason,
        createdAt: 1,
        updatedAt: 2,
      });

      const outcome = await resolveForegroundInterruptedResponseOutcome({
        assertNotAborted: jest.fn(),
        conversationId: mockCurrentConversation.id,
        error: new Error('stream interrupted'),
        finalizationProviderContext: {} as never,
        runId: 'run-1',
        signal: new AbortController().signal,
      });

      expect(outcome).toEqual(
        expect.objectContaining({
          status: 'failed',
          checkpointTitle: 'Turn failed',
          checkpointDetail: expect.stringContaining('blocked required goals'),
        }),
      );
      expect(outcome).not.toHaveProperty('resumePrompt');
    },
  );

  it('does not let an active persistent focus block finite-run completion', async () => {
    seedGoal({
      id: 'focus',
      title: 'Remember my style',
      status: 'active',
      dependencies: [],
      evidence: [],
      completionPolicy: 'persistent',
      createdAt: 1,
      updatedAt: 2,
    });

    await expect(
      resolveForegroundInterruptedResponseOutcome({
        assertNotAborted: jest.fn(),
        conversationId: mockCurrentConversation.id,
        error: new Error('stream interrupted'),
        finalizationProviderContext: {} as never,
        runId: 'run-1',
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ status: 'completed', checkpointTitle: 'Goals satisfied' });
  });
});
