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
import { createRunningAgentRun } from '../../../testSupport/chatScreen/fixtures';
import {
  mockStartAgentRun,
  mockSetAgentRunPhase,
  mockUpdateAgentRunAsyncWork,
  mockCompleteAgentRun,
} from '../../../testSupport/chatScreen/storeMocks';
import { mockRunOrchestrator } from '../../../testSupport/chatScreen/serviceMocks';

describe('ChatScreen agent run monitoring', () => {
  beforeEach(resetChatScreenTestEnvironment);

  afterEach(cleanupChatScreenTestEnvironment);

  it('finalizes the run instead of entering background-worker monitoring after the supervisor turn ends', async () => {
    jest.useFakeTimers();

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Keep monitoring background work');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    mockChatScreenState.activeSubAgents = [
      {
        sessionId: 'sub-background-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: Date.now() - 3000,
        updatedAt: Date.now(),
        status: 'running',
        sandboxPolicy: 'inherit',
      },
    ];

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    await act(async () => {
      callbacks.onDone();
      await Promise.resolve();
    });

    expect(mockUpdateAgentRunAsyncWork).not.toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        awaitingBackgroundWorkers: true,
        checkpointTitle: 'Waiting for background workers',
        latestSummary: 'Waiting for 1 background worker to finish.',
      }),
      'run-1',
    );
    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'completed',
        checkpointTitle: 'Turn completed',
      }),
      'run-1',
    );

    jest.useRealTimers();
  });

  it('does not enter background-worker monitoring after delegated worker status checks finish', async () => {
    jest.useFakeTimers();

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(
      getByPlaceholderText('Message...'),
      'Monitor the delegated worker before final review',
    );
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    mockChatScreenState.activeSubAgents = [
      {
        sessionId: 'sub-background-monitor-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: Date.now() - 3000,
        updatedAt: Date.now(),
        status: 'running',
        sandboxPolicy: 'inherit',
        currentActivity: 'Inspecting repository files',
      },
    ];

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onAssistantMessage('Checking the delegated worker status.', [
        {
          id: 'tc-status-running',
          name: 'sessions_status',
          arguments: '{"sessionId":"sub-background-monitor-1"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-status-running',
        name: 'sessions_status',
        arguments: '{"sessionId":"sub-background-monitor-1"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-status-running',
        name: 'sessions_status',
        arguments: '{"sessionId":"sub-background-monitor-1"}',
        status: 'completed',
        result: JSON.stringify({
          status: 'running',
          sessionId: 'sub-background-monitor-1',
          currentActivity: 'Inspecting repository files',
        }),
      });
    });

    await act(async () => {
      callbacks.onDone();
      await Promise.resolve();
    });

    expect(mockSetAgentRunPhase.mock.calls.filter(([, phase]) => phase === 'review')).toHaveLength(
      0,
    );
    expect(mockUpdateAgentRunAsyncWork).not.toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        awaitingBackgroundWorkers: true,
        checkpointTitle: 'Waiting for background workers',
        latestSummary: 'Waiting for 1 background worker to finish.',
      }),
      'run-1',
    );
    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'completed',
      }),
      'run-1',
    );

    jest.useRealTimers();
  });

  it('keeps async operation monitoring in the work phase while the operation is still pending', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(
      getByPlaceholderText('Message...'),
      'Keep monitoring the async workflow before final review',
    );
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    const pendingOperation = {
      key: 'expo-workflow:workflow-101',
      kind: 'expo-workflow',
      resourceId: 'workflow-101',
      displayName: 'Expo workflow 101',
      status: 'running',
      lastUpdatedByTool: 'expo_eas_build',
      updatedAt: Date.now(),
      monitorToolNames: ['expo_eas_workflow_status', 'expo_eas_workflow_wait'],
      statusArgs: { projectId: 'proj-1', workflowRunId: '101' },
      waitToolName: 'expo_eas_workflow_wait',
      waitArgs: { projectId: 'proj-1', workflowRunId: '101' },
    };

    mockSetAgentRunPhase.mockClear();

    act(() => {
      callbacks.onPendingAsyncOperationsChange([pendingOperation]);
      callbacks.onAssistantMessage('Checking the Expo workflow status.', [
        {
          id: 'tc-expo-status',
          name: 'expo_eas_workflow_status',
          arguments: '{"projectId":"proj-1","workflowRunId":"101"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-expo-status',
        name: 'expo_eas_workflow_status',
        arguments: '{"projectId":"proj-1","workflowRunId":"101"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-expo-status',
        name: 'expo_eas_workflow_status',
        arguments: '{"projectId":"proj-1","workflowRunId":"101"}',
        status: 'completed',
        result: JSON.stringify({
          projectId: 'proj-1',
          mode: 'github-workflow',
          workflowRun: {
            id: 101,
            status: 'in_progress',
          },
        }),
      });
    });

    expect(mockUpdateAgentRunAsyncWork).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        pendingOperations: [pendingOperation],
        latestSummary: expect.any(String),
      }),
      'run-1',
    );
    expect(mockSetAgentRunPhase.mock.calls.some(([, phase]) => phase === 'work')).toBe(true);
    expect(mockSetAgentRunPhase.mock.calls.filter(([, phase]) => phase === 'review')).toHaveLength(
      0,
    );
  });

  it('keeps async monitoring tools in work when monitoring callbacks arrive before async state is persisted', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(
      getByPlaceholderText('Message...'),
      'Monitor async workflow even if callback order is inverted',
    );
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    const pendingOperation = {
      key: 'expo-workflow:workflow-222',
      kind: 'expo-workflow',
      resourceId: 'workflow-222',
      displayName: 'Expo workflow 222',
      status: 'running',
      lastUpdatedByTool: 'expo_eas_build',
      updatedAt: Date.now(),
      monitorToolNames: ['expo_eas_workflow_status', 'expo_eas_workflow_wait'],
      statusArgs: { projectId: 'proj-2', workflowRunId: '222' },
      waitToolName: 'expo_eas_workflow_wait',
      waitArgs: { projectId: 'proj-2', workflowRunId: '222' },
    };

    mockSetAgentRunPhase.mockClear();

    act(() => {
      callbacks.onAssistantMessage('Checking workflow status first.', [
        {
          id: 'tc-expo-status-race',
          name: 'expo_eas_workflow_status',
          arguments: '{"projectId":"proj-2","workflowRunId":"222"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-expo-status-race',
        name: 'expo_eas_workflow_status',
        arguments: '{"projectId":"proj-2","workflowRunId":"222"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-expo-status-race',
        name: 'expo_eas_workflow_status',
        arguments: '{"projectId":"proj-2","workflowRunId":"222"}',
        status: 'completed',
        result: JSON.stringify({
          projectId: 'proj-2',
          mode: 'github-workflow',
          workflowRun: {
            id: 222,
            status: 'in_progress',
          },
        }),
      });
      callbacks.onPendingAsyncOperationsChange([pendingOperation]);
    });

    expect(mockSetAgentRunPhase.mock.calls.some(([, phase]) => phase === 'work')).toBe(true);
    expect(mockSetAgentRunPhase.mock.calls.filter(([, phase]) => phase === 'review')).toHaveLength(
      0,
    );
  });

  it('keeps sessions monitoring in work immediately after spawn before live worker snapshots catch up', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(
      getByPlaceholderText('Message...'),
      'Spawn and monitor worker without entering review early',
    );
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    mockChatScreenState.activeSubAgents = [];
    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    mockSetAgentRunPhase.mockClear();

    act(() => {
      callbacks.onAssistantMessage('Launching worker.', [
        {
          id: 'tc-spawn-race',
          name: 'sessions_spawn',
          arguments: '{"prompt":"Audit repo","name":"Race worker"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-spawn-race',
        name: 'sessions_spawn',
        arguments: '{"prompt":"Audit repo","name":"Race worker"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-spawn-race',
        name: 'sessions_spawn',
        arguments: '{"prompt":"Audit repo","name":"Race worker"}',
        status: 'completed',
        result: JSON.stringify({ status: 'running', sessionId: 'sub-race-worker-1' }),
      });

      callbacks.onAssistantMessage('Monitoring worker status.', [
        {
          id: 'tc-status-race',
          name: 'sessions_status',
          arguments: '{"sessionId":"sub-race-worker-1"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-status-race',
        name: 'sessions_status',
        arguments: '{"sessionId":"sub-race-worker-1"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-status-race',
        name: 'sessions_status',
        arguments: '{"sessionId":"sub-race-worker-1"}',
        status: 'completed',
        result: JSON.stringify({
          status: 'running',
          sessionId: 'sub-race-worker-1',
          currentActivity: 'Indexing files',
        }),
      });
    });

    expect(mockSetAgentRunPhase.mock.calls.some(([, phase]) => phase === 'work')).toBe(true);
    expect(mockSetAgentRunPhase.mock.calls.filter(([, phase]) => phase === 'review')).toHaveLength(
      0,
    );
  });
});
