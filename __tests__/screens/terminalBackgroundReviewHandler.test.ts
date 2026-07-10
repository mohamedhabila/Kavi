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
    goals: [],
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

function invoke(recordConversationTurnMemory: jest.Mock): Promise<void> {
  const controller = new AbortController();
  return handleTerminalBackgroundReview({
    appendConversationLog: jest.fn(),
    assertNotAborted: jest.fn(),
    completeAgentRun: jest.fn(),
    conversationId: conversation.id,
    context: {
      conversation,
      targetRun: run,
      candidateSummary: 'Worker completed.',
      candidateStatus: 'completed',
    },
    ensureAgentRunFinalResponse: jest.fn().mockResolvedValue('Final answer'),
    recordConversationTurnMemory,
    reviewTimestamp: 10,
    runId: run.id,
    signal: controller.signal,
    setAgentRunPhase: jest.fn(),
    updateAgentRunAsyncWork: jest.fn(),
    updateAgentRunSummary: jest.fn(),
    updateMessageAssistantMetadata: jest.fn(),
  });
}

describe('terminal background review memory closeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useChatStore.setState({
      conversations: [conversation],
      activeConversationId: conversation.id,
      isLoading: false,
    });
  });

  it('records memory once after the terminal compare-and-set succeeds', async () => {
    jest.mocked(completeTerminalBackgroundReviewRun).mockReturnValue(true);
    const recordConversationTurnMemory = jest.fn();

    await invoke(recordConversationTurnMemory);

    expect(recordConversationTurnMemory).toHaveBeenCalledTimes(1);
    expect(recordConversationTurnMemory).toHaveBeenCalledWith(conversation.id, undefined, {
      memoryConversationId: conversation.id,
      sourceRunId: run.id,
    });
  });

  it('does not record memory after losing the terminal compare-and-set race', async () => {
    jest.mocked(completeTerminalBackgroundReviewRun).mockReturnValue(false);
    const recordConversationTurnMemory = jest.fn();

    await invoke(recordConversationTurnMemory);

    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
  });
});
