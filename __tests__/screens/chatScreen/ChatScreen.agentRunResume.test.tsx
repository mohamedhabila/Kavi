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
  createAgentRunControlGraphState,
  createAgentRunAsyncWorkControlGraph,
} from '../../../testSupport/chatScreen/fixtures';
import {
  mockAddConversationLog,
  mockStartAgentRun,
  mockSetAgentRunPhase,
  mockUpdateAgentRunAsyncWork,
  mockCompleteAgentRun,
} from '../../../testSupport/chatScreen/storeMocks';
import {
  mockEvaluateAgentRunWithPilot,
  mockRunOrchestrator,
} from '../../../testSupport/chatScreen/serviceMocks';

describe('ChatScreen agent run resume', () => {
  beforeEach(resetChatScreenTestEnvironment);

  afterEach(cleanupChatScreenTestEnvironment);

  it('recovers a running async-monitoring run back into work instead of review', async () => {
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

    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        activeAgentRunId: 'run-async-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-async-1',
            userMessageId: 'msg1',
            currentPhase: 'review',
            latestSummary: 'Async monitoring was interrupted.',
            controlGraph: createAgentRunAsyncWorkControlGraph({
              pendingOperations: [pendingOperation],
            }),
          }),
        ],
      },
    ];

    render(<ChatScreen />);

    await waitFor(() => {
      expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
        'conv1',
        'work',
        expect.objectContaining({
          checkpointTitle: 'Recovered async workflow monitoring',
          allowRegression: true,
        }),
        'run-async-1',
      );
    });

    expect(
      mockSetAgentRunPhase.mock.calls.some(
        ([, phase, params, runId]) =>
          phase === 'review' &&
          params?.checkpointTitle === 'Recovered async workflow monitoring' &&
          runId === 'run-async-1',
      ),
    ).toBe(false);
  });

  it('passes persisted lean graph state into resumed supervisor runs', async () => {
    const pendingOperation = {
      key: 'expo-workflow:workflow-102',
      kind: 'expo-workflow',
      resourceId: 'workflow-102',
      displayName: 'Expo workflow 102',
      status: 'running',
      lastUpdatedByTool: 'expo_eas_workflow_wait',
      updatedAt: Date.now(),
      monitorToolNames: ['expo_eas_workflow_wait'],
      waitToolName: 'expo_eas_workflow_wait',
      waitArgs: { projectId: 'proj-1', workflowRunId: '102' },
    };
    const controlGraph = createAgentRunControlGraphState({
      status: 'waiting_async',
      iteration: 3,
      expectedToolCalls: [],
      observedToolResults: [],
      pendingAsyncCount: 1,
      lastModelToolNames: ['expo_eas_workflow_wait'],
      activeTaskId: 'goal-await-external',
      goals: [
        {
          id: 'goal-await-external',
          title: 'Wait for external execution',
          status: 'active',
          dependencies: [],
          evidence: ['already-completed'],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      asyncWork: {
        awaitingBackgroundWorkers: false,
        pendingOperations: [pendingOperation],
        updatedAt: Date.now(),
      },
      updatedAt: Date.now(),
    });

    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        activeAgentRunId: 'run-async-route',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-async-route',
            userMessageId: 'msg1',
            controlGraph,
          }),
        ],
      },
    ];

    render(<ChatScreen />);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [resumeOptions] = mockRunOrchestrator.mock.calls[0];
    expect(resumeOptions.conversationId).toBe('conv1');
    expect(resumeOptions.initialPendingAsyncOperations).toEqual([
      expect.objectContaining({
        ...pendingOperation,
        blocksFinalization: true,
      }),
    ]);
    const resumedGraphState = resumeOptions.initialAgentControlGraphState;
    expect(resumedGraphState.status).toBe('waiting_async');
    expect(resumedGraphState.iteration).toBe(3);
    expect(resumedGraphState.pendingAsyncCount).toBe(1);
    expect(resumedGraphState.lastModelToolNames).toEqual(['expo_eas_workflow_wait']);
    expect(resumedGraphState.asyncWork).toEqual(
      expect.objectContaining({
        pendingOperations: [
          expect.objectContaining({
            ...pendingOperation,
            blocksFinalization: true,
          }),
        ],
      }),
    );
    expect(resumedGraphState.activeTaskId).toBe('goal-await-external');
    expect(resumedGraphState.goals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'goal-await-external',
          status: 'active',
        }),
      ]),
    );
    expect(resumedGraphState.workflowRoute).toBeUndefined();
  });

  it('does not synthesize background-worker monitoring when a detached worker launch succeeds before live snapshots become visible', async () => {
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
      'Launch worker and wait for visibility',
    );
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    mockUpdateAgentRunAsyncWork.mockClear();
    mockCompleteAgentRun.mockClear();

    act(() => {
      callbacks.onAssistantMessage('Launching delegated worker.', [
        {
          id: 'tc-spawn-lag',
          name: 'sessions_spawn',
          arguments: '{"prompt":"Audit files"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-spawn-lag',
        name: 'sessions_spawn',
        arguments: '{"prompt":"Audit files"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-spawn-lag',
        name: 'sessions_spawn',
        arguments: '{"prompt":"Audit files"}',
        status: 'completed',
        result: JSON.stringify({ status: 'running', sessionId: 'sub-spawn-lag-1' }),
      });
      callbacks.onDone();
    });
    await waitFor(() => {
      expect(mockUpdateAgentRunAsyncWork).not.toHaveBeenCalled();
    });
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

  it('queues recovered async monitoring for every resumable run instead of only the first one', async () => {
    const pendingOperation = {
      key: 'expo-workflow:workflow-201',
      kind: 'expo-workflow',
      resourceId: 'workflow-201',
      displayName: 'Expo workflow 201',
      status: 'running',
      lastUpdatedByTool: 'expo_eas_build',
      updatedAt: Date.now(),
      monitorToolNames: ['expo_eas_workflow_status', 'expo_eas_workflow_wait'],
      statusArgs: { projectId: 'proj-201', workflowRunId: '201' },
      waitToolName: 'expo_eas_workflow_wait',
      waitArgs: { projectId: 'proj-201', workflowRunId: '201' },
    };

    const [baseConversation] = createDefaultConversations();
    mockChatScreenState.conversations = [
      {
        ...baseConversation,
        id: 'conv1',
        activeAgentRunId: 'run-async-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-async-1',
            userMessageId: 'msg1',
            controlGraph: createAgentRunAsyncWorkControlGraph({
              pendingOperations: [pendingOperation],
            }),
          }),
        ],
      },
      {
        ...baseConversation,
        id: 'conv2',
        activeAgentRunId: 'run-async-2',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-async-2',
            userMessageId: 'msg1',
            controlGraph: createAgentRunAsyncWorkControlGraph({
              pendingOperations: [
                {
                  ...pendingOperation,
                  key: 'expo-workflow:workflow-202',
                  resourceId: 'workflow-202',
                  displayName: 'Expo workflow 202',
                  statusArgs: { projectId: 'proj-202', workflowRunId: '202' },
                  waitArgs: { projectId: 'proj-202', workflowRunId: '202' },
                },
              ],
            }),
          }),
        ],
      },
    ];

    render(<ChatScreen />);

    await waitFor(() => {
      expect(
        mockSetAgentRunPhase.mock.calls.some(
          ([conversationId, phase, params, runId]) =>
            conversationId === 'conv1' &&
            phase === 'work' &&
            params?.checkpointTitle === 'Recovered async workflow monitoring' &&
            runId === 'run-async-1',
        ),
      ).toBe(true);
      expect(
        mockSetAgentRunPhase.mock.calls.some(
          ([conversationId, phase, params, runId]) =>
            conversationId === 'conv2' &&
            phase === 'work' &&
            params?.checkpointTitle === 'Recovered async workflow monitoring' &&
            runId === 'run-async-2',
        ),
      ).toBe(true);
    });
  });

  it('fails the run instead of entering background-worker monitoring when the supervisor stream fails', async () => {
    jest.useFakeTimers();

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
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Finish after the verifier returns');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    mockChatScreenState.activeSubAgents = [
      {
        sessionId: 'sub-background-error-1',
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
      callbacks.onError(
        new Error(
          'The model response ended before tool-call emission completed (UNEXPECTED_TOOL_CALL). Partial tool calls were discarded to avoid executing incomplete actions.',
        ),
      );
      callbacks.onDone();
      await Promise.resolve();
    });
    expect(mockUpdateAgentRunAsyncWork).not.toHaveBeenCalled();
    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'failed',
        checkpointTitle: 'Turn failed',
      }),
      'run-1',
    );

    jest.useRealTimers();
  });

  it('keeps the run open on completion when async monitoring is still pending', async () => {
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
      'Monitor async workflow to completion',
    );
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    const pendingOperation = {
      key: 'expo-workflow:workflow-303',
      kind: 'expo-workflow',
      resourceId: 'workflow-303',
      displayName: 'Expo workflow 303',
      status: 'running',
      lastUpdatedByTool: 'expo_eas_build',
      updatedAt: Date.now(),
      monitorToolNames: ['expo_eas_workflow_status', 'expo_eas_workflow_wait'],
      statusArgs: { projectId: 'proj-3', workflowRunId: '303' },
      waitToolName: 'expo_eas_workflow_wait',
      waitArgs: { projectId: 'proj-3', workflowRunId: '303' },
    };

    act(() => {
      callbacks.onPendingAsyncOperationsChange([pendingOperation]);
      callbacks.onDone();
    });

    await waitFor(() => {
      expect(mockCompleteAgentRun).not.toHaveBeenCalledWith('conv1', expect.anything(), 'run-1');
    });

    expect(mockEvaluateAgentRunWithPilot).not.toHaveBeenCalled();
    expect(mockAddConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: 'Async monitoring still active',
      }),
    );
  });
});
