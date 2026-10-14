import {
  act,
  fireEvent,
  render,
  waitFor,
  ChatScreen,
} from '../../../testSupport/chatScreen/runtime';
import {
  cleanupChatScreenTestEnvironment,
  resetInFlightChatScreenTestEnvironment,
} from '../../../testSupport/chatScreen/mockDefaults';
import { mockChatScreenState, updateMockConversation } from '../../../testSupport/chatScreen/state';
import {
  createAgentRunControlGraphState,
  createRunningAgentRun,
} from '../../../testSupport/chatScreen/fixtures';
import {
  mockStartAgentRun,
  mockCompleteAgentRun,
} from '../../../testSupport/chatScreen/storeMocks';
import {
  mockEvaluateAgentRunWithPilot,
  mockRunOrchestrator,
} from '../../../testSupport/chatScreen/serviceMocks';

describe('ChatScreen run interruption recovery', () => {
  beforeEach(resetInFlightChatScreenTestEnvironment);

  afterEach(cleanupChatScreenTestEnvironment);

  // An interrupted run used to be read as completed from its verified work and resumed with
  // tools disabled; it now fails, and the work it finished stays shown as done.
  it('fails a response interruption even when its work is verified', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
            latestSummary: 'Synthesizing final answer from verified worker results.',
            controlGraph: createAgentRunControlGraphState({
              status: 'awaiting_review',
            }),
            summary: {
              assistantTurns: 1,
              startedTools: 3,
              completedTools: 3,
              failedTools: 0,
              spawnedSubAgents: 2,
            },
          }),
        ],
      }));
      return 'run-1';
    });
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onError(new Error('OpenAI streaming error'));
      callbacks.onDone();
      return { terminalDisposition: 'failed' };
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Analyze Android 16 readiness');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockCompleteAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          status: 'failed',
          checkpointTitle: 'Turn failed',
        }),
        'run-1',
      );
    });

    expect(mockEvaluateAgentRunWithPilot).not.toHaveBeenCalled();
  });

  // The step-limit message used to be replaced by an answer synthesized from the run's tool
  // results. It now stays, so the person can carry the task on from it.
  it('keeps the step-limit message instead of replacing it with a synthesized answer', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
            latestSummary: 'Final verification loop still in progress.',
            controlGraph: createAgentRunControlGraphState({
              status: 'awaiting_review',
            }),
            summary: {
              assistantTurns: 1,
              startedTools: 4,
              completedTools: 4,
              failedTools: 0,
              spawnedSubAgents: 2,
            },
          }),
        ],
      }));
      return 'run-1';
    });
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onAssistantMessage(
        "I've reached the maximum number of tool iterations. Here's what I've accomplished so far with the tools I've used.",
        [],
        undefined,
        {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'max_iterations',
        },
      );
      callbacks.onAgentControlGraphStateChange(
        createAgentRunControlGraphState({ status: 'finalized', terminalReason: 'max_iterations' }),
      );
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Summarize the verified workflow blocker for the user.');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockCompleteAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({ status: 'failed', checkpointTitle: 'Run blocked' }),
        'run-1',
      );
    });

    const latestAssistantMessage = [...mockChatScreenState.conversations[0].messages]
      .reverse()
      .find((message: any) => message.role === 'assistant');
    expect(latestAssistantMessage).toEqual(
      expect.objectContaining({
        content: expect.stringContaining('maximum number of tool iterations'),
        assistantMetadata: expect.objectContaining({ finishReason: 'max_iterations' }),
      }),
    );
  });

  it('fails an interrupted run whose workers completed, without running it again', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
            controlGraph: createAgentRunControlGraphState({
              status: 'awaiting_review',
            }),
          }),
        ],
      }));
      return 'run-1';
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Recover the interrupted structured task');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    updateMockConversation('conv1', (conversation) => ({
      ...conversation,
      messages: [
        ...conversation.messages,
        {
          id: 'assistant-recovery-complete-worker',
          role: 'assistant',
          content: 'Worker completed successfully before the stream failed.',
          timestamp: 1_700_000_300_250,
          subAgentEvent: {
            type: 'sub-agent',
            event: 'completed',
            snapshot: {
              sessionId: 'sub-recovery-complete-1',
              parentConversationId: 'conv1',
              agentRunId: 'run-1',
              workstreamId: 'workstream-1',
              depth: 0,
              startedAt: 1_700_000_300_050,
              updatedAt: 1_700_000_300_250,
              status: 'completed',
              sandboxPolicy: 'inherit',
              output: 'Worker finished with verified output before the interruption.',
            },
          },
        },
      ],
    }));
    mockChatScreenState.activeSubAgents = [];

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    await act(async () => {
      callbacks.onError(new Error('OpenAI streaming error'));
      callbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockCompleteAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          status: 'failed',
          checkpointTitle: 'Turn failed',
        }),
        'run-1',
      );
    });

    expect(mockEvaluateAgentRunWithPilot).not.toHaveBeenCalled();
    expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
  });
});
