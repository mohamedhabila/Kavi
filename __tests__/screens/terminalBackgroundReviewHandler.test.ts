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

function invoke(
  recordConversationTurnMemory: jest.Mock,
  options?: {
    candidateStatus?: 'completed' | 'failed';
    ensureAgentRunFinalResponse?: jest.Mock;
    flushChatState?: jest.Mock;
    targetRun?: AgentRun;
    resumeAgentRun?: jest.Mock;
  },
): Promise<void> {
  const controller = new AbortController();
  const ensureAgentRunFinalResponse =
    options?.ensureAgentRunFinalResponse ??
    jest.fn().mockImplementation(async () => {
      useChatStore.getState().addMessage(conversation.id, {
        id: 'final-1',
        role: 'assistant',
        content: 'Final answer',
        timestamp: 9,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      });
      return 'Final answer';
    });
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
      targetRun: options?.targetRun ?? run,
      candidateSummary: 'Worker completed.',
      candidateStatus: options?.candidateStatus ?? 'completed',
    },
    ensureAgentRunFinalResponse,
    flushChatState: options?.flushChatState ?? jest.fn().mockResolvedValue(undefined),
    recordConversationTurnMemory,
    resumeAgentRun: options?.resumeAgentRun,
    reviewTimestamp: 10,
    runId: run.id,
    signal: controller.signal,
    setAgentRunPhase: jest.fn(),
    updateAgentRunAsyncWork: jest.fn(),
    updateAgentRunControlGraph: jest.fn(),
    updateAgentRunSummary: jest.fn(),
    updateMessageAssistantMetadata: jest.fn(),
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

  it('does not transition a completed review when final delivery was not persisted', async () => {
    const recordConversationTurnMemory = jest.fn();
    const ensureAgentRunFinalResponse = jest.fn().mockResolvedValue('Unpersisted preview');

    await invoke(recordConversationTurnMemory, { ensureAgentRunFinalResponse });

    expect(ensureAgentRunFinalResponse).toHaveBeenCalledTimes(1);
    expect(completeTerminalBackgroundReviewRun).not.toHaveBeenCalled();
    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
  });

  it('does not transition a failed review when its final report was not persisted', async () => {
    const recordConversationTurnMemory = jest.fn();
    const ensureAgentRunFinalResponse = jest.fn().mockResolvedValue('Unpersisted failure');

    await invoke(recordConversationTurnMemory, {
      candidateStatus: 'failed',
      ensureAgentRunFinalResponse,
    });

    expect(ensureAgentRunFinalResponse).toHaveBeenCalledTimes(1);
    expect(completeTerminalBackgroundReviewRun).not.toHaveBeenCalled();
    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
  });
});
