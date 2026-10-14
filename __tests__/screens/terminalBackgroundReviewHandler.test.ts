import { handleTerminalBackgroundReview } from '../../src/screens/terminalBackgroundReviewHandler';
import { completeTerminalBackgroundReviewRun } from '../../src/screens/terminalBackgroundCompletion';
import { useChatStore } from '../../src/store/useChatStore';
import type { AgentRun } from '../../src/types/agentRun';
import type { Conversation } from '../../src/types/conversation';

jest.mock('../../src/screens/terminalBackgroundCompletion', () => ({
  completeTerminalBackgroundReviewRun: jest.fn(),
}));

const run: AgentRun = {
  id: 'run-1',
  userMessageId: 'user-1',
  goal: 'Finish background work',
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
  controlGraph: {
    version: 1,
    status: 'waiting_async',
    iteration: 1,
    expectedToolCalls: [],
    observedToolResults: [],
    pendingAsyncCount: 1,
    lastModelToolNames: [],
    asyncWork: {
      pendingOperations: [],
      awaitingBackgroundWorkers: true,
      updatedAt: 2,
    },
    performance: {
      modelTurnCount: 1,
      modelDurationMs: 1,
      toolExecutionCount: 1,
      toolExecutionDurationMs: 1,
      lastCandidateToolCount: 1,
      lastActiveToolCount: 1,
      maxActiveToolCount: 1,
      lastActiveToolTokenEstimate: 1,
      maxActiveToolTokenEstimate: 1,
      updatedAt: 2,
    },
    turnDirectives: {
      forceFinalText: false,
      requireWorkflowTool: false,
      incompleteFinalTextRecoveryCount: 0,
    },
    audit: [],
    updatedAt: 2,
  },
};

const conversation: Conversation = {
  id: 'conversation-1',
  title: 'Background run',
  messages: [{ id: 'user-1', role: 'user', content: run.goal, timestamp: 1 }],
  createdAt: 1,
  updatedAt: 2,
  agentRuns: [run],
};

const finalAnswer = {
  id: 'final-1',
  role: 'assistant' as const,
  content: 'Final answer',
  timestamp: 9,
  assistantMetadata: {
    kind: 'final' as const,
    completionStatus: 'complete' as const,
    finishReason: 'stop',
  },
};

function invoke(
  recordConversationTurnMemory: jest.Mock,
  options?: {
    flushChatState?: jest.Mock;
    resumeAgentRun?: jest.Mock;
    withFinalAnswer?: boolean;
  },
): Promise<void> {
  if (options?.withFinalAnswer !== false) {
    useChatStore.getState().addMessage(conversation.id, finalAnswer);
  }
  const currentConversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversation.id)!;
  return handleTerminalBackgroundReview({
    appendConversationLog: jest.fn(),
    assertNotAborted: jest.fn(),
    completeAgentRun: jest.fn(),
    conversationId: conversation.id,
    context: {
      conversation: currentConversation,
      targetRun: run,
      candidateSummary: 'Worker completed.',
      candidateStatus: 'completed',
    },
    flushChatState: options?.flushChatState ?? jest.fn().mockResolvedValue(undefined),
    recordConversationTurnMemory,
    resumeAgentRun: options?.resumeAgentRun,
    reviewTimestamp: 10,
    runId: run.id,
    updateAgentRunControlGraph: jest.fn(),
  });
}

describe('terminal background review turn capture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useChatStore.setState({
      conversations: [conversation],
      activeConversationId: conversation.id,
      isLoading: false,
    });
  });

  it('persists and captures the settled final before the terminal compare-and-set', async () => {
    jest.mocked(completeTerminalBackgroundReviewRun).mockReturnValue(true);
    const recordConversationTurnMemory = jest.fn();
    const flushChatState = jest.fn().mockResolvedValue(undefined);

    await invoke(recordConversationTurnMemory, { flushChatState });

    expect(recordConversationTurnMemory).toHaveBeenCalledTimes(1);
    expect(recordConversationTurnMemory).toHaveBeenCalledWith(conversation.id, 'final-1');
    expect(flushChatState.mock.invocationCallOrder[0]).toBeLessThan(
      recordConversationTurnMemory.mock.invocationCallOrder[0],
    );
    expect(recordConversationTurnMemory.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(completeTerminalBackgroundReviewRun).mock.invocationCallOrder[0],
    );
    expect(flushChatState).toHaveBeenCalledTimes(2);
  });

  it('captures the final but skips the second flush after losing the compare-and-set race', async () => {
    jest.mocked(completeTerminalBackgroundReviewRun).mockReturnValue(false);
    const recordConversationTurnMemory = jest.fn();
    const flushChatState = jest.fn().mockResolvedValue(undefined);

    await invoke(recordConversationTurnMemory, { flushChatState });

    expect(recordConversationTurnMemory).toHaveBeenCalledWith(conversation.id, 'final-1');
    expect(flushChatState).toHaveBeenCalledTimes(1);
  });

  // A run whose workers finished without it having answered used to get an answer synthesized
  // from their output by a separate model call. It is resumed through the agent loop instead.
  it("resumes a run that has not answered, so it answers from its workers' results", async () => {
    const recordConversationTurnMemory = jest.fn();
    const resumeAgentRun = jest.fn().mockResolvedValue(undefined);

    await invoke(recordConversationTurnMemory, { resumeAgentRun, withFinalAnswer: false });

    expect(resumeAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: conversation.id,
        runId: run.id,
        assistantDraftMode: 'new',
      }),
    );
    expect(resumeAgentRun.mock.calls[0][0]).not.toHaveProperty('disableTools');
    expect(completeTerminalBackgroundReviewRun).not.toHaveBeenCalled();
    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
  });
});
