import { createInitialAgentControlGraphSnapshot } from '../../../src/engine/graph/agentControlGraph';
import { handleForegroundRunReviewFinalDelivery } from '../../../src/engine/graph/foregroundRun/reviewFinalDelivery';
import { buildForegroundRunReviewContext } from '../../../src/engine/graph/foregroundRun/reviewContext';
import type { AgentRun } from '../../../src/types/agentRun';
import type { Conversation } from '../../../src/types/conversation';

describe('foreground final-delivery automatic recovery budget', () => {
  it('persists the first automatic attempt before resuming final delivery', async () => {
    const run = {
      id: 'run-1',
      userMessageId: 'user-1',
      goal: 'Finish the task',
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
      controlGraph: createInitialAgentControlGraphSnapshot({ status: 'awaiting_review' }),
    } as AgentRun;
    const conversation = {
      id: 'conversation-1',
      title: 'Recovery',
      messages: [{ id: 'user-1', role: 'user', content: 'Finish the task', timestamp: 1 }],
      createdAt: 1,
      updatedAt: 2,
      agentRuns: [run],
    } as Conversation;
    const updateAgentRunControlGraph = jest.fn();
    const flushChatState = jest.fn().mockResolvedValue(undefined);
    const resumeAgentRun = jest.fn().mockResolvedValue(undefined);

    await expect(
      handleForegroundRunReviewFinalDelivery({
        appendConversationLog: jest.fn(),
        assertNotAborted: jest.fn(),
        conversationId: conversation.id,
        context: buildForegroundRunReviewContext({
          reviewConversation: conversation,
          reviewRun: run,
        }),
        finalizeTrackedRun: jest.fn(),
        flushChatState,
        getLatestConversation: () => conversation,
        recoverAgentRunFinalPreview: jest.fn().mockResolvedValue({
          recovered: false,
          delivered: false,
        }),
        resumeAgentRun,
        runId: run.id,
        signal: new AbortController().signal,
        setAgentRunPhase: jest.fn(),
        updateAgentRunControlGraph,
        updateAgentRunSummary: jest.fn(),
      }),
    ).resolves.toEqual({ handled: true, terminalized: false });

    expect(updateAgentRunControlGraph).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({
        status: 'ready',
        turnDirectives: expect.objectContaining({ automaticRecoveryAttemptCount: 1 }),
      }),
      run.id,
    );
    expect(updateAgentRunControlGraph.mock.invocationCallOrder[0]).toBeLessThan(
      flushChatState.mock.invocationCallOrder[0],
    );
    expect(flushChatState.mock.invocationCallOrder[0]).toBeLessThan(
      resumeAgentRun.mock.invocationCallOrder[0],
    );
  });

  it('delivers a visible failure and terminalizes instead of auto-resuming twice', async () => {
    const run = {
      id: 'run-1',
      userMessageId: 'user-1',
      goal: 'Finish the task',
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
        status: 'awaiting_review',
        turnDirectives: {
          forceFinalText: false,
          requireWorkflowTool: false,
          incompleteFinalTextRecoveryCount: 0,
          automaticRecoveryAttemptCount: 1,
        },
      }),
    } as AgentRun;
    const conversation = {
      id: 'conversation-1',
      title: 'Recovery',
      messages: [
        { id: 'user-1', role: 'user', content: 'Finish the task', timestamp: 1 },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'incomplete',
            finishReason: 'response_failed',
          },
        },
      ],
      createdAt: 1,
      updatedAt: 2,
      agentRuns: [run],
    } as Conversation;
    const recoverAgentRunFinalPreview = jest
      .fn()
      .mockResolvedValueOnce({ recovered: false, delivered: false })
      .mockResolvedValueOnce({
        preview: 'Automatic recovery stopped. Retry manually.',
        recovered: true,
        delivered: true,
      });
    const finalizeTrackedRun = jest.fn().mockReturnValue(true);
    const resumeAgentRun = jest.fn();
    const appendConversationLog = jest.fn();

    await expect(
      handleForegroundRunReviewFinalDelivery({
        appendConversationLog,
        assertNotAborted: jest.fn(),
        conversationId: conversation.id,
        context: buildForegroundRunReviewContext({
          reviewConversation: conversation,
          reviewRun: run,
        }),
        finalizeTrackedRun,
        flushChatState: jest.fn().mockResolvedValue(undefined),
        getLatestConversation: () => conversation,
        recoverAgentRunFinalPreview,
        resumeAgentRun,
        runId: run.id,
        signal: new AbortController().signal,
        setAgentRunPhase: jest.fn(),
        updateAgentRunControlGraph: jest.fn(),
        updateAgentRunSummary: jest.fn(),
      }),
    ).resolves.toEqual({ handled: true, terminalized: true });

    expect(recoverAgentRunFinalPreview).toHaveBeenNthCalledWith(
      1,
      'completed',
      expect.any(Number),
      undefined,
      expect.any(AbortSignal),
    );
    expect(recoverAgentRunFinalPreview).toHaveBeenNthCalledWith(
      2,
      'failed',
      expect.any(Number),
      undefined,
      expect.any(AbortSignal),
    );
    expect(resumeAgentRun).not.toHaveBeenCalled();
    expect(finalizeTrackedRun).toHaveBeenCalledWith(
      'failed',
      expect.stringContaining('persisted retry limit'),
      'Final delivery recovery stopped',
      expect.stringContaining('persisted retry limit'),
      'terminal_review_unavailable',
    );
    expect(appendConversationLog).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({ level: 'error', title: 'Final delivery recovery stopped' }),
    );
  });
});
