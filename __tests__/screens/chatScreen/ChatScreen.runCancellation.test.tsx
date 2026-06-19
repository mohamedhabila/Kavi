import {
  act,
  fireEvent,
  render,
  waitFor,
  ChatScreen,
  memoizedChatInputType,
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
  nextMockTimestamp,
} from '../../../testSupport/chatScreen/fixtures';
import {
  mockSetLoading,
  mockAddConversationLog,
  mockStartAgentRun,
  mockCompleteAgentRun,
} from '../../../testSupport/chatScreen/storeMocks';
import {
  mockCancelSubAgent,
  mockRunOrchestrator,
} from '../../../testSupport/chatScreen/serviceMocks';

describe('ChatScreen run cancellation', () => {
  beforeEach(resetChatScreenTestEnvironment);

  afterEach(cleanupChatScreenTestEnvironment);

  it('handles orchestrator rejection', async () => {
    mockRunOrchestrator.mockRejectedValueOnce(new Error('Network failed'));
    const { getByPlaceholderText, getByTestId, findByText } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Fail test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    const error = await findByText('Network failed');
    expect(error).toBeTruthy();
    expect(mockSetLoading).toHaveBeenCalledWith(false);
  });

  it('does not show error for cancellation', async () => {
    mockRunOrchestrator.mockRejectedValueOnce(new Error('Request cancelled'));
    const { getByPlaceholderText, getByTestId, queryByText } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Cancel test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockSetLoading).toHaveBeenCalledWith(false);
    });
    expect(queryByText('Request cancelled')).toBeNull();
  });

  it('does not show error banner initially', () => {
    const { queryByTestId } = render(<ChatScreen />);
    expect(queryByTestId('icon-AlertTriangle')).toBeNull();
  });

  it('keeps the active conversation in loading state while a run is still active', () => {
    mockChatScreenState.loadingState = false;
    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        activeAgentRunId: 'run-pilot-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-pilot-1',
            userMessageId: 'msg1',
            currentPhase: 'pilot',
            latestSummary: 'Pilot review still active.',
          }),
        ],
      },
    ];

    const screen = render(<ChatScreen />);

    expect(screen.UNSAFE_getByType(memoizedChatInputType).props.isLoading).toBe(true);
  });

  it('handles stop action', () => {
    mockChatScreenState.loadingState = true;
    mockChatScreenState.conversations = [
      {
        ...mockChatScreenState.conversations[0],
        activeAgentRunId: 'run-1',
        agentRuns: [
          {
            id: 'run-1',
            userMessageId: 'msg1',
            goal: 'Coordinate the current task.',
            status: 'running',
            createdAt: Date.now() - 2000,
            updatedAt: Date.now() - 1000,
            currentPhase: 'work',
            phases: [],
            checkpoints: [],
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 0,
              failedTools: 0,
              spawnedSubAgents: 1,
            },
          },
        ],
      },
    ];
    mockChatScreenState.activeSubAgents = [
      {
        sessionId: 'worker-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        status: 'running',
      },
      {
        sessionId: 'worker-2',
        parentConversationId: 'conv1',
        agentRunId: 'run-other',
        status: 'running',
      },
    ];

    const { getByTestId } = render(<ChatScreen />);
    const stopIcon = getByTestId('icon-Square');
    fireEvent.press(stopIcon.parent || stopIcon);

    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'cancelled',
        latestSummary: 'The current run was cancelled and 1 background worker was stopped.',
        checkpointTitle: 'Turn cancelled',
        checkpointDetail: 'The current run was cancelled and 1 background worker was stopped.',
      }),
      'run-1',
    );
    expect(mockCancelSubAgent).toHaveBeenCalledWith(
      'worker-1',
      'Cancelled because the supervising turn was stopped by the user.',
    );
    expect(mockCancelSubAgent).toHaveBeenCalledTimes(1);
    expect(mockAddConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: 'Generation stopped and workers cancelled',
        detail: 'The current run was cancelled and 1 background worker was stopped.',
      }),
    );
  });

  it('clears the streaming indicator when stopping an in-flight response', async () => {
    mockChatScreenState.defaultConversationMode = 'chitchat';
    mockRunOrchestrator.mockImplementationOnce(
      async (options: any) =>
        await new Promise<void>((resolve) => {
          options.signal.signal.addEventListener('abort', () => resolve(), { once: true });
        }),
    );

    const screen = render(<ChatScreen />);
    fireEvent.changeText(
      screen.getByPlaceholderText('Message...'),
      'Review the cleanup workflow and produce a final report',
    );
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    act(() => {
      callbacks.onToken('Draft answer');
    });

    await waitFor(() => {
      expect(screen.getByTestId('message-bubble-streaming')).toBeTruthy();
    });

    const stopIcon = screen.getByTestId('icon-Square');
    fireEvent.press(stopIcon.parent || stopIcon);

    await waitFor(() => {
      expect(screen.queryByTestId('message-bubble-streaming')).toBeNull();
    });

    expect(mockSetLoading).toHaveBeenCalledWith(false);
  });

  it('cancels a running pilot-stage workflow even when activeAgentRunId is missing', () => {
    const cancelAgentRunOperationsSpy = jest.spyOn(
      require('../../../src/services/agents/agentRunCancellation'),
      'cancelAgentRunOperations',
    );

    try {
      mockChatScreenState.loadingState = false;
      mockChatScreenState.conversations = [
        {
          ...createDefaultConversations()[0],
          activeAgentRunId: undefined,
          agentRuns: [
            createRunningAgentRun({
              id: 'run-pilot-stop-1',
              userMessageId: 'msg1',
              currentPhase: 'pilot',
              latestSummary: 'Pilot review is still running.',
            }),
          ],
        },
      ];

      const { getByTestId } = render(<ChatScreen />);
      const stopIcon = getByTestId('icon-Square');
      fireEvent.press(stopIcon.parent || stopIcon);

      expect(cancelAgentRunOperationsSpy).toHaveBeenCalledWith(
        'conv1',
        'run-pilot-stop-1',
        'Cancelled because the supervising turn was stopped by the user.',
      );
      expect(mockCompleteAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          status: 'cancelled',
          latestSummary: 'The current run was cancelled.',
          checkpointTitle: 'Turn cancelled',
          checkpointDetail: 'The current run was cancelled.',
        }),
        'run-pilot-stop-1',
      );
    } finally {
      cancelAgentRunOperationsSpy.mockRestore();
    }
  });

  it('cancels fallback-matched workers when stopping the active run', () => {
    mockChatScreenState.loadingState = true;
    mockChatScreenState.conversations = [
      {
        ...mockChatScreenState.conversations[0],
        activeAgentRunId: 'run-1',
        agentRuns: [
          {
            id: 'run-1',
            userMessageId: 'msg1',
            goal: 'Coordinate the current task.',
            status: 'running',
            createdAt: Date.now() - 2000,
            updatedAt: Date.now() - 1000,
            currentPhase: 'work',
            phases: [],
            checkpoints: [],
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 0,
              failedTools: 0,
              spawnedSubAgents: 1,
            },
          },
        ],
      },
    ];
    mockChatScreenState.activeSubAgents = [
      {
        sessionId: 'worker-fallback-1',
        parentConversationId: 'conv1',
        status: 'running',
      },
      {
        sessionId: 'worker-fallback-2',
        parentConversationId: 'conv2',
        status: 'running',
      },
    ];

    const { getByTestId } = render(<ChatScreen />);
    const stopIcon = getByTestId('icon-Square');
    fireEvent.press(stopIcon.parent || stopIcon);

    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'cancelled',
        latestSummary: 'The current run was cancelled and 1 background worker was stopped.',
        checkpointTitle: 'Turn cancelled',
        checkpointDetail: 'The current run was cancelled and 1 background worker was stopped.',
      }),
      'run-1',
    );
    expect(mockCancelSubAgent).toHaveBeenCalledWith(
      'worker-fallback-1',
      'Cancelled because the supervising turn was stopped by the user.',
    );
    expect(mockCancelSubAgent).toHaveBeenCalledTimes(1);
  });

  it('cancels the superseded run operations and workers before starting a new turn', async () => {
    const cancelAgentRunOperationsSpy = jest.spyOn(
      require('../../../src/services/agents/agentRunCancellation'),
      'cancelAgentRunOperations',
    );
    cancelAgentRunOperationsSpy.mockImplementation(() => undefined);

    mockChatScreenState.conversations = [
      {
        ...mockChatScreenState.conversations[0],
        activeAgentRunId: 'run-1',
        messages: [
          {
            id: 'msg-old-user',
            role: 'user',
            content: 'Finish the prior task',
            timestamp: 1_700_000_000_000,
          },
        ] as any[],
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: 'msg-old-user',
            goal: 'Finish the prior task.',
            controlGraph: createAgentRunAsyncWorkControlGraph({
              awaitingBackgroundWorkers: true,
            }),
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_100,
          }),
        ],
      },
    ];
    mockChatScreenState.activeSubAgents = [
      {
        sessionId: 'worker-superseded-1',
        parentConversationId: 'conv1',
        status: 'running',
        startedAt: 1_700_000_000_050,
        updatedAt: 1_700_000_000_120,
      },
    ];
    mockCompleteAgentRun.mockImplementationOnce(
      (conversationId: string, params: any, runId: string) => {
        const timestamp = nextMockTimestamp();
        updateMockConversation(conversationId, (conversation) => ({
          ...conversation,
          activeAgentRunId:
            conversation.activeAgentRunId === runId ? undefined : conversation.activeAgentRunId,
          agentRuns: (conversation.agentRuns ?? []).map((run: any) =>
            run.id === runId
              ? {
                  ...run,
                  status: params?.status ?? 'completed',
                  controlGraph: createAgentRunAsyncWorkControlGraph({
                    awaitingBackgroundWorkers: false,
                    pendingOperations: [],
                    updatedAt: timestamp,
                  }),
                  latestSummary: params?.latestSummary,
                  completedAt: timestamp,
                  updatedAt: timestamp,
                }
              : run,
          ),
        }));
      },
    );
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-2',
        agentRuns: [
          ...(conversation.agentRuns ?? []),
          createRunningAgentRun({
            id: 'run-2',
            userMessageId: params.userMessageId,
            goal: params.goal,
            createdAt: 1_700_000_000_200,
            updatedAt: 1_700_000_000_200,
          }),
        ],
      }));
      return 'run-2';
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Start the replacement task');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockStartAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          goal: 'Start the replacement task',
        }),
      );
    });

    expect(cancelAgentRunOperationsSpy).toHaveBeenCalledWith(
      'conv1',
      'run-1',
      'Superseded by a new user turn.',
    );
    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'cancelled',
        checkpointTitle: 'Run superseded',
        latestSummary:
          'A new user turn started before the previous run finished and 1 background worker was stopped.',
      }),
      'run-1',
    );
    expect(mockCancelSubAgent).toHaveBeenCalledWith(
      'worker-superseded-1',
      'Cancelled because a new user turn superseded the active run.',
    );
    expect(mockAddConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: 'Previous run superseded and workers cancelled',
        detail:
          'A new user turn started before the previous run finished and 1 background worker was stopped.',
      }),
    );

    cancelAgentRunOperationsSpy.mockRestore();
  });

  it('cancels an awaiting background worker run when the user stops it', async () => {
    mockChatScreenState.loadingState = true;

    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          {
            id: 'msg-user-stop-background',
            role: 'user',
            content: 'Recover the worker result.',
            timestamp: 1_700_000_400_000,
          },
        ],
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: 'msg-user-stop-background',
            controlGraph: createAgentRunAsyncWorkControlGraph({
              awaitingBackgroundWorkers: true,
            }),
            latestSummary: 'Waiting for 1 background worker to finish.',
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
    ];
    mockChatScreenState.activeSubAgents = [
      {
        sessionId: 'sub-stop-background-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: 1_700_000_400_050,
        updatedAt: 1_700_000_400_250,
        status: 'running',
        sandboxPolicy: 'inherit',
        output: 'Worker verification in progress.',
      },
    ];

    const screen = render(<ChatScreen />);

    const stopIcon = screen.getByTestId('icon-Square');
    fireEvent.press(stopIcon.parent || stopIcon);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'cancelled',
        checkpointTitle: 'Turn cancelled',
      }),
      'run-1',
    );
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });
});
