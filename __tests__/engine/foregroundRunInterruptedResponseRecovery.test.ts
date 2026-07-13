import { handleForegroundInterruptedResponseRecovery } from '../../src/engine/graph/foregroundRun/interruptedResponseRecovery';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { useChatStore } from '../../src/store/useChatStore';

function seedRunningRun(automaticRecoveryAttemptCount = 0): void {
  useChatStore.setState({
    conversations: [
      {
        id: 'conversation-1',
        title: 'Recovery',
        messages: [{ id: 'user-1', role: 'user', content: 'Finish this', timestamp: 1 }],
        createdAt: 1,
        updatedAt: 2,
        agentRuns: [
          {
            id: 'run-1',
            userMessageId: 'user-1',
            goal: 'Finish this',
            status: 'running',
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
            controlGraph: createInitialAgentControlGraphSnapshot({
              status: 'failed',
              turnDirectives: {
                forceFinalText: false,
                requireWorkflowTool: false,
                incompleteFinalTextRecoveryCount: 0,
                ...(automaticRecoveryAttemptCount > 0 ? { automaticRecoveryAttemptCount } : {}),
              },
            }),
          },
        ],
      } as never,
    ],
    activeConversationId: 'conversation-1',
    isLoading: false,
  });
}

describe('foreground interrupted response final delivery', () => {
  it('keeps a completable run open when recovery returned no persisted settled final', async () => {
    const finalizeTrackedRun = jest.fn();
    const setAgentRunPhase = jest.fn();
    const updateAgentRunSummary = jest.fn();
    const requestPersistenceCheckpoint = jest.fn();
    const markCurrentAssistantDraftIncomplete = jest.fn();

    await handleForegroundInterruptedResponseRecovery({
      appendConversationLog: jest.fn(),
      assertNotAborted: jest.fn(),
      clearForegroundRequestIfCurrent: jest.fn(() => true),
      conversationId: 'conversation-1',
      currentAssistantMessageId: 'assistant-1',
      errorMessage: 'stream interrupted',
      finalizeTrackedRun,
      flushChatState: jest.fn().mockResolvedValue(undefined),
      markCurrentAssistantDraftIncomplete,
      outcome: {
        status: 'completed',
        checkpointTitle: 'Goals satisfied',
        checkpointDetail: 'Required goals have verified evidence.',
      },
      recoverAgentRunFinalPreview: jest.fn(async () => ({
        recovered: false,
        delivered: false,
      })),
      requestPersistenceCheckpoint,
      runId: 'run-1',
      setAgentRunPhase,
      setChatError: jest.fn(),
      signal: new AbortController().signal,
      updateAgentRunAsyncWork: jest.fn(),
      updateAgentRunControlGraph: jest.fn(),
      updateAgentRunSummary,
      updateMessage: jest.fn(),
      updateMessageAssistantMetadata: jest.fn(),
      visibleContent: 'Partial answer',
    });

    expect(finalizeTrackedRun).not.toHaveBeenCalled();
    expect(markCurrentAssistantDraftIncomplete).toHaveBeenCalledWith(
      'Partial answer',
      'terminal_review_pending',
    );
    expect(setAgentRunPhase).toHaveBeenCalledWith(
      'conversation-1',
      'deliver',
      expect.objectContaining({
        status: 'active',
        checkpointTitle: 'Final delivery recovery pending',
      }),
      'run-1',
    );
    expect(updateAgentRunSummary).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({
        latestSummary: expect.stringContaining('Final delivery remains retryable'),
      }),
      'run-1',
    );
    expect(requestPersistenceCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('does not report recovered success when the graph rejects terminalization', async () => {
    const appendConversationLog = jest.fn();
    const finalizeTrackedRun = jest.fn().mockReturnValue(false);
    const markCurrentAssistantDraftIncomplete = jest.fn();
    const requestPersistenceCheckpoint = jest.fn();
    const resumeAgentRun = jest.fn().mockResolvedValue(undefined);
    seedRunningRun();

    await handleForegroundInterruptedResponseRecovery({
      appendConversationLog,
      assertNotAborted: jest.fn(),
      clearForegroundRequestIfCurrent: jest.fn(() => true),
      conversationId: 'conversation-1',
      currentAssistantMessageId: 'assistant-1',
      errorMessage: 'stream interrupted',
      finalizeTrackedRun,
      flushChatState: jest.fn().mockResolvedValue(undefined),
      markCurrentAssistantDraftIncomplete,
      outcome: {
        status: 'completed',
        checkpointTitle: 'Goals satisfied',
        checkpointDetail: 'Required goals have verified evidence.',
      },
      recoverAgentRunFinalPreview: jest.fn(async () => ({
        preview: 'Recovered result',
        recovered: true,
        delivered: true,
      })),
      requestPersistenceCheckpoint,
      resumeAgentRun,
      runId: 'run-1',
      setAgentRunPhase: jest.fn(),
      setChatError: jest.fn(),
      signal: new AbortController().signal,
      updateAgentRunAsyncWork: jest.fn(),
      updateAgentRunControlGraph: jest.fn(),
      updateAgentRunSummary: jest.fn(),
      updateMessage: jest.fn(),
      updateMessageAssistantMetadata: jest.fn(),
      visibleContent: 'Partial answer',
    });

    expect(finalizeTrackedRun).toHaveBeenCalledTimes(1);
    expect(markCurrentAssistantDraftIncomplete).toHaveBeenCalledWith(
      'Partial answer',
      'terminal_review_pending',
    );
    expect(appendConversationLog).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({
        level: 'warning',
        title: 'Final delivery recovery pending',
      }),
    );
    expect(appendConversationLog).not.toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({ title: 'Response interrupted; recovered final answer' }),
    );
    expect(requestPersistenceCheckpoint).toHaveBeenCalledTimes(1);
    expect(resumeAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        runId: 'run-1',
        disableTools: true,
        assistantDraftMode: 'new',
      }),
    );
  });

  it('fails visibly instead of issuing a second automatic recovery request', async () => {
    seedRunningRun(1);
    const resumeAgentRun = jest.fn();
    const finalizeTrackedRun = jest.fn().mockReturnValue(true);
    const updateMessage = jest.fn();
    const updateMessageAssistantMetadata = jest.fn();

    await handleForegroundInterruptedResponseRecovery({
      appendConversationLog: jest.fn(),
      assertNotAborted: jest.fn(),
      clearForegroundRequestIfCurrent: jest.fn(() => true),
      conversationId: 'conversation-1',
      currentAssistantMessageId: 'assistant-1',
      errorMessage: 'provider failed again',
      finalizeTrackedRun,
      flushChatState: jest.fn().mockResolvedValue(undefined),
      markCurrentAssistantDraftIncomplete: jest.fn(),
      outcome: {
        status: 'failed',
        checkpointTitle: 'Goals still open',
        checkpointDetail: 'More work is required.',
        resumePrompt: 'Continue the open goals.',
      },
      recoverAgentRunFinalPreview: jest.fn(),
      requestPersistenceCheckpoint: jest.fn(),
      resumeAgentRun,
      runId: 'run-1',
      setAgentRunPhase: jest.fn(),
      setChatError: jest.fn(),
      signal: new AbortController().signal,
      updateAgentRunAsyncWork: jest.fn(),
      updateAgentRunControlGraph: jest.fn(),
      updateAgentRunSummary: jest.fn(),
      updateMessage,
      updateMessageAssistantMetadata,
      visibleContent: '',
    });

    expect(resumeAgentRun).not.toHaveBeenCalled();
    expect(finalizeTrackedRun).toHaveBeenCalledWith(
      'failed',
      expect.stringContaining('persisted retry limit'),
      'Automatic recovery stopped',
      expect.stringContaining('persisted retry limit'),
      'terminal_review_unavailable',
    );
    expect(updateMessage).toHaveBeenCalledWith(
      'conversation-1',
      'assistant-1',
      expect.stringContaining('persisted retry limit'),
    );
    expect(updateMessageAssistantMetadata).toHaveBeenCalledWith(
      'conversation-1',
      'assistant-1',
      expect.objectContaining({ completionStatus: 'incomplete', finishReason: 'response_failed' }),
    );
  });
});
