import {
  act,
  fireEvent,
  render,
  waitFor,
  ChatScreen,
} from '../../../testSupport/chatScreen/runtime';
import {
  cleanupChatScreenTestEnvironment,
  resetChatScreenTestEnvironment,
} from '../../../testSupport/chatScreen/mockDefaults';
import { mockChatScreenState, updateMockConversation } from '../../../testSupport/chatScreen/state';
import {
  createAgentRunControlGraphState,
  createRunningAgentRun,
} from '../../../testSupport/chatScreen/fixtures';
import {
  mockAddConversationLog,
  mockStartAgentRun,
  mockCompleteAgentRun,
} from '../../../testSupport/chatScreen/storeMocks';
import {
  mockCollectAgentRunFinalizationEvidence,
  mockSynthesizeAgentRunFinalAnswer,
  mockEvaluateAgentRunWithPilot,
  mockRunOrchestrator,
} from '../../../testSupport/chatScreen/serviceMocks';

describe('ChatScreen run interruption recovery', () => {
  beforeEach(resetChatScreenTestEnvironment);

  afterEach(cleanupChatScreenTestEnvironment);

  it('recovers a response interruption as a completed run when goals and evidence are satisfied', async () => {
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
              goals: [
                {
                  id: 'goal-1',
                  title: 'Analyze Android 16 readiness',
                  status: 'completed',
                  dependencies: [],
                  evidence: ['verified worker findings'],
                  createdAt: 1,
                  updatedAt: 2,
                },
              ],
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
    mockCollectAgentRunFinalizationEvidence.mockImplementation(() => ({
      originalPrompt: 'Analyze Android 16 readiness',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: '',
      lastSubstantiveResult:
        'Verified worker findings confirm the requested deliverable is complete.',
      resultPreviews: [
        {
          sourceName: 'Android 16 Researcher',
          preview: 'Compiled Android 16 platform changes and mitigations.',
        },
        {
          sourceName: 'Expo Readiness Researcher',
          preview: 'Verified Expo ecosystem readiness and gaps.',
        },
      ],
      toolsUsed: ['sessions_spawn', 'sessions_status', 'web_fetch'],
      iterations: 3,
      hasIncompleteToolCalls: false,
    }));
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onError(new Error('OpenAI streaming error'));
      callbacks.onDone();
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
          status: 'completed',
          checkpointTitle: 'Goals satisfied',
        }),
        'run-1',
      );
    });

    expect(mockEvaluateAgentRunWithPilot).not.toHaveBeenCalled();
  });

  it('synthesizes a final response instead of delivering the max-iterations placeholder', async () => {
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
    mockCollectAgentRunFinalizationEvidence.mockImplementation(() => ({
      originalPrompt: 'Summarize the verified workflow blocker for the user.',
      transcriptMessages: [],
      lastNonEmptyAssistantContent:
        "I've reached the maximum number of tool iterations. Here's what I've accomplished so far with the tools I've used.",
      lastSubstantiveResult: 'Verified blocker findings are ready for delivery.',
      resultPreviews: [
        {
          sourceName: 'Final Verification Specialist',
          preview: 'Verified blocker findings are ready for delivery.',
        },
      ],
      toolsUsed: ['sessions_spawn', 'sessions_wait', 'sessions_output'],
      iterations: 4,
      hasIncompleteToolCalls: false,
    }));
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
      callbacks.onDone();
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Summarize the verified workflow blocker for the user.');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockSynthesizeAgentRunFinalAnswer).toHaveBeenCalledTimes(1);
      expect(mockCompleteAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          status: 'completed',
          checkpointTitle: 'Final response delivered',
          latestSummary: 'Synthesized final response',
        }),
        'run-1',
      );
    });

    expect(mockEvaluateAgentRunWithPilot).not.toHaveBeenCalled();
    const latestAssistantMessage = [...mockChatScreenState.conversations[0].messages]
      .reverse()
      .find((message: any) => message.role === 'assistant');

    expect(latestAssistantMessage).toEqual(
      expect.objectContaining({
        content: 'Synthesized final response',
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'complete',
        }),
      }),
    );
    expect(mockAddConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: 'Final response delivered',
        detail: 'Synthesized final response',
      }),
    );
  });

  it('recovers an interrupted run from persisted completed worker snapshots when live workers are absent', async () => {
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
              goals: [
                {
                  id: 'workstream-1',
                  title: 'Implement the fix',
                  status: 'completed',
                  dependencies: [],
                  evidence: ['Worker finished with verified output before the interruption.'],
                  createdAt: 1,
                  updatedAt: 2,
                },
              ],
            }),
          }),
        ],
      }));
      return 'run-1';
    });
    mockCollectAgentRunFinalizationEvidence.mockImplementation(() => ({
      originalPrompt: 'Recover the interrupted structured task',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: 'Worker completed successfully before the stream failed.',
      lastSubstantiveResult: 'Worker finished with verified output before the interruption.',
      resultPreviews: [
        {
          sourceName: 'Worker',
          preview: 'Worker finished with verified output before the interruption.',
        },
      ],
      toolsUsed: ['sessions_spawn', 'sessions_wait'],
      iterations: 2,
      hasIncompleteToolCalls: false,
    }));

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
          status: 'completed',
          checkpointTitle: 'Goals satisfied',
        }),
        'run-1',
      );
    });

    expect(mockEvaluateAgentRunWithPilot).not.toHaveBeenCalled();
    expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
  });
});
