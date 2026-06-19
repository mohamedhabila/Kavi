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
  createDefaultConversations,
  createRunningAgentRun,
  createAgentRunAsyncWorkControlGraph,
} from '../../../testSupport/chatScreen/fixtures';
import { mockAddMessage, mockEditMessage } from '../../../testSupport/chatScreen/storeMocks';
import { mockEvaluateAgentRunWithPilot, mockCancelSubAgent } from '../../../testSupport/chatScreen/serviceMocks';
import { mockCompleteAgentRun } from '../../../testSupport/chatScreen/storeMocks';

describe('ChatScreen editing and drafts', () => {
  beforeEach(resetChatScreenTestEnvironment);
  afterEach(cleanupChatScreenTestEnvironment);

  it('shows edit actions on user messages', () => {
    const { getAllByTestId } = render(<ChatScreen />);
    const editIcons = getAllByTestId('icon-Edit2');
    expect(editIcons.length).toBeGreaterThanOrEqual(1);
  });

  it('shows retry actions on assistant messages', () => {
    const { getAllByTestId } = render(<ChatScreen />);
    const retryIcons = getAllByTestId('icon-RotateCcw');
    expect(retryIcons.length).toBeGreaterThanOrEqual(1);
  });

  it('enters edit mode when edit icon is pressed', () => {
    const { getAllByTestId, getByDisplayValue } = render(<ChatScreen />);
    const editIcons = getAllByTestId('icon-Edit2');
    fireEvent.press(editIcons[0].parent || editIcons[0]);
    expect(getByDisplayValue('Hello')).toBeTruthy();
  });

  it('handles retry by re-sending previous user message', async () => {
    const { getAllByTestId } = render(<ChatScreen />);
    const retryIcons = getAllByTestId('icon-RotateCcw');
    fireEvent.press(retryIcons[0].parent || retryIcons[0]);

    await waitFor(() => {
      // retry triggers handleSend with the previous user message content
      expect(mockAddMessage).toHaveBeenCalled();
    });
  });

  it('cancels the active run before retry rewinds the conversation', async () => {
    const cancelAgentRunOperationsSpy = jest.spyOn(
      require('../../../src/services/agents/agentRunCancellation'),
      'cancelAgentRunOperations',
    );

    try {
      mockChatScreenState.conversations = [
        {
          ...createDefaultConversations()[0],
          activeAgentRunId: 'run-retry-1',
          agentRuns: [
            createRunningAgentRun({
              id: 'run-retry-1',
              userMessageId: 'msg1',
            }),
          ],
        },
      ];
      mockChatScreenState.activeSubAgents = [
        {
          sessionId: 'worker-retry-1',
          parentConversationId: 'conv1',
          agentRunId: 'run-retry-1',
          status: 'running',
        },
      ];
      mockEditMessage.mockImplementation(
        (conversationId: string, messageId: string, content: string) => {
          updateMockConversation(conversationId, (conversation) => {
            const messageIndex = conversation.messages.findIndex(
              (message: any) => message.id === messageId,
            );
            return {
              ...conversation,
              messages: conversation.messages
                .slice(0, messageIndex + 1)
                .map((message: any) =>
                  message.id === messageId ? { ...message, content } : message,
                ),
              agentRuns: [],
              activeAgentRunId: undefined,
            };
          });
        },
      );

      const screen = render(<ChatScreen />);
      const retryIcons = screen.getAllByTestId('icon-RotateCcw');
      fireEvent.press(retryIcons[0].parent || retryIcons[0]);

      await waitFor(() => {
        expect(cancelAgentRunOperationsSpy).toHaveBeenCalledWith(
          'conv1',
          'run-retry-1',
          'Cancelled because the active run was rewound for a retry.',
        );
      });

      expect(mockCancelSubAgent).toHaveBeenCalledWith(
        'worker-retry-1',
        'Cancelled because the active run was rewound for a retry.',
      );
    } finally {
      cancelAgentRunOperationsSpy.mockRestore();
    }
  });

  it('handles edit send by editing message and re-sending', async () => {
    const { getAllByTestId, getByDisplayValue, getByTestId } = render(<ChatScreen />);
    // Press edit on user message
    const editIcons = getAllByTestId('icon-Edit2');
    fireEvent.press(editIcons[0].parent || editIcons[0]);

    // Edit the content
    const editInput = getByDisplayValue('Hello');
    fireEvent.changeText(editInput, 'Edited hello');
    // Press send (in edit mode, ChatInput fires onSend which is handleEditSend)
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockEditMessage).toHaveBeenCalledWith('conv1', 'msg1', 'Edited hello');
    });
  });

  it('restores the unsent draft after cancelling edit mode', () => {
    const screen = render(<ChatScreen />);
    const input = screen.getByPlaceholderText('Message...');

    fireEvent.changeText(input, 'Draft before edit');
    fireEvent.press(
      screen.getAllByTestId('icon-Edit2')[0].parent || screen.getAllByTestId('icon-Edit2')[0],
    );

    expect(screen.getByDisplayValue('Hello')).toBeTruthy();

    const cancelEditIcon = screen.getByTestId('icon-X');
    fireEvent.press(cancelEditIcon.parent || cancelEditIcon);

    expect(screen.getByDisplayValue('Draft before edit')).toBeTruthy();
  });

  it('clears edit mode when switching conversations', async () => {
    mockChatScreenState.conversations = [
      ...createDefaultConversations(),
      {
        id: 'conv2',
        title: 'Second Chat',
        messages: [
          { id: 'conv2-user', role: 'user', content: 'Second hello', timestamp: Date.now() },
          {
            id: 'conv2-assistant',
            role: 'assistant',
            content: 'Second reply',
            timestamp: Date.now(),
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        providerId: 'openai',
        model: 'gpt-5.4',
        systemPrompt: 'You are helpful',
        usage: {
          entries: [],
          totalInput: 0,
          totalOutput: 0,
          totalCacheRead: 0,
          totalCacheWrite: 0,
          totalTokens: 0,
          totalCost: 0,
          totalCalls: 0,
        },
        logs: [],
        agentRuns: [],
      },
    ];

    const screen = render(<ChatScreen />);
    const editIcons = screen.getAllByTestId('icon-Edit2');
    fireEvent.press(editIcons[0].parent || editIcons[0]);

    expect(screen.getByDisplayValue('Hello')).toBeTruthy();

    act(() => {
      mockChatScreenState.activeConversationId = 'conv2';
      screen.rerender(<ChatScreen />);
    });

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Hello')).toBeNull();
    });
    expect(screen.getByText('Second hello')).toBeTruthy();
    expect(screen.getByText('Second reply')).toBeTruthy();
  });

  it('continues background worker review after switching to another conversation', async () => {
    const workerSnapshot = {
      sessionId: 'worker-conv1-1',
      parentConversationId: 'conv1',
      agentRunId: 'run-conv1-1',
      status: 'completed',
      startedAt: 1_700_000_000_010,
      updatedAt: 1_700_000_000_020,
      depth: 1,
      sandboxPolicy: 'inherit',
      name: 'Verifier',
      completionState: 'verified_success',
      toolsUsed: ['read_file'],
      output: 'Verified the result in conversation 1.',
    };

    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        id: 'conv1',
        messages: [
          { id: 'conv1-user', role: 'user', content: 'Finish conversation 1', timestamp: 1 },
          {
            id: 'conv1-assistant',
            role: 'assistant',
            content: 'Waiting on the verifier.',
            timestamp: 2,
          },
          {
            id: 'conv1-worker',
            role: 'assistant',
            content: 'Verifier completed.',
            timestamp: 3,
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: workerSnapshot,
            },
          },
        ],
        activeAgentRunId: 'run-conv1-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-conv1-1',
            userMessageId: 'conv1-user',
            controlGraph: createAgentRunAsyncWorkControlGraph({
              awaitingBackgroundWorkers: true,
            }),
            latestSummary: 'Waiting for background workers.',
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 1,
              failedTools: 0,
              spawnedSubAgents: 1,
            },
          }),
        ],
      },
      {
        ...createDefaultConversations()[0],
        id: 'conv2',
        title: 'Second Chat',
        messages: [
          { id: 'conv2-user', role: 'user', content: 'Second hello', timestamp: 10 },
          {
            id: 'conv2-assistant',
            role: 'assistant',
            content: 'Second reply',
            timestamp: 11,
          },
        ],
        activeAgentRunId: undefined,
        agentRuns: [],
      },
    ];
    mockChatScreenState.activeConversationId = 'conv2';
    mockChatScreenState.activeSubAgents = [workerSnapshot];

    render(<ChatScreen />);

    await act(async () => {
      mockChatScreenState.subAgentListener?.(workerSnapshot, 'completed');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockCompleteAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          checkpointTitle: 'Background workers finished',
        }),
        'run-conv1-1',
      );
    });

    expect(mockEvaluateAgentRunWithPilot).not.toHaveBeenCalled();
  });
});
