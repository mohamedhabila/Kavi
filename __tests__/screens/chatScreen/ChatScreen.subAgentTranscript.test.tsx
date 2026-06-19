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
import { mockChatScreenState } from '../../../testSupport/chatScreen/state';
import {
  createDefaultConversations,
  createRunningAgentRun,
  createAgentRunAsyncWorkControlGraph,
} from '../../../testSupport/chatScreen/fixtures';
import {
  mockAddMessage,
  mockAddConversationLog,
  mockSetAgentRunPhase,
  mockCompleteAgentRun,
} from '../../../testSupport/chatScreen/storeMocks';
import { mockSynthesizeAgentRunFinalAnswer } from '../../../testSupport/chatScreen/serviceMocks';

describe('ChatScreen sub-agent transcript', () => {
  beforeEach(resetChatScreenTestEnvironment);

  afterEach(cleanupChatScreenTestEnvironment);

  it('keeps one transcript worker widget when same-session lifecycle messages are separated by tool output', () => {
    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          {
            id: 'msg-user-worker',
            role: 'user',
            content: 'Investigate this',
            timestamp: 1_700_000_000_000,
          },
          {
            id: 'assistant-worker-started',
            role: 'assistant',
            content: 'Planner started.',
            timestamp: 1_700_000_000_100,
            subAgentEvent: {
              type: 'sub-agent',
              event: 'started',
              snapshot: {
                sessionId: 'sub-stable-1',
                parentConversationId: 'conv1',
                name: 'Planner',
                depth: 1,
                startedAt: 1_700_000_000_100,
                updatedAt: 1_700_000_000_100,
                status: 'running',
                sandboxPolicy: 'inherit',
                currentActivity: 'Inspecting files',
              },
            },
          },
          {
            id: 'tool-worker-ignored',
            role: 'tool',
            content: 'ignored tool output',
            timestamp: 1_700_000_000_150,
          },
          {
            id: 'assistant-worker-completed',
            role: 'assistant',
            content: 'Planner completed.',
            timestamp: 1_700_000_000_200,
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: {
                sessionId: 'sub-stable-1',
                parentConversationId: 'conv1',
                name: 'Planner',
                depth: 1,
                startedAt: 1_700_000_000_100,
                updatedAt: 1_700_000_000_200,
                status: 'completed',
                sandboxPolicy: 'inherit',
                output: 'Worker finished the audit.',
              },
            },
          },
        ],
      },
    ];

    const screen = render(<ChatScreen />);

    expect(screen.queryAllByTestId('sub-agent-open-details')).toHaveLength(1);
    expect(screen.getByText('Planner completed.')).toBeTruthy();
    expect(screen.getByText('Inspecting files')).toBeTruthy();
  });

  it('finalizes an awaiting background run only once when terminal worker events race', async () => {
    let resolveFinalization: ((value: { output: string; providerReplay: any }) => void) | undefined;
    mockSynthesizeAgentRunFinalAnswer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFinalization = resolve;
        }),
    );
    mockCompleteAgentRun.mockImplementation(
      (conversationId: string, params: any, runId: string) => {
        mockChatScreenState.conversations = mockChatScreenState.conversations.map((conversation) =>
          conversation.id !== conversationId
            ? conversation
            : {
                ...conversation,
                activeAgentRunId: undefined,
                agentRuns: (conversation.agentRuns ?? []).map((run: any) =>
                  run.id !== runId
                    ? run
                    : {
                        ...run,
                        status: params.status ?? 'completed',
                        controlGraph: createAgentRunAsyncWorkControlGraph({
                          awaitingBackgroundWorkers: false,
                          pendingOperations: [],
                          updatedAt: run.updatedAt,
                        }),
                        latestSummary: params.latestSummary ?? run.latestSummary,
                      },
                ),
              },
        );
      },
    );

    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          {
            id: 'msg-user-tool',
            role: 'user',
            content: 'Finish the repository audit',
            timestamp: 1_700_000_000_000,
          },
          {
            id: 'assistant-tool-1',
            role: 'assistant',
            content: 'I launched workers and I am waiting for the results.',
            timestamp: 1_700_000_000_050,
            toolCalls: [
              {
                id: 'tc-spawn',
                name: 'sessions_spawn',
                arguments: '{"prompt":"Audit the repository"}',
                status: 'completed',
                result: '{"summary":"Workers launched successfully."}',
                startedAt: 1_700_000_000_100,
                updatedAt: 1_700_000_000_150,
                completedAt: 1_700_000_000_150,
              },
            ],
          },
        ],
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: 'msg-user-tool',
            controlGraph: createAgentRunAsyncWorkControlGraph({
              awaitingBackgroundWorkers: true,
            }),
            latestSummary: 'Waiting for 2 background workers to finish.',
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 1,
              failedTools: 0,
              spawnedSubAgents: 2,
            },
          }),
        ],
      },
    ];
    mockChatScreenState.activeSubAgents = [
      {
        sessionId: 'sub-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: 1_700_000_000_100,
        updatedAt: 1_700_000_000_300,
        status: 'completed',
        sandboxPolicy: 'inherit',
        completionState: 'verified_success',
        output: 'Worker one completed the repository audit.',
        toolsUsed: ['read_file'],
      },
      {
        sessionId: 'sub-2',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: 1_700_000_000_120,
        updatedAt: 1_700_000_000_320,
        status: 'completed',
        sandboxPolicy: 'inherit',
        completionState: 'verified_success',
        output: 'Worker two verified the repository audit.',
        toolsUsed: ['grep_search'],
      },
    ];

    render(<ChatScreen />);

    expect(typeof mockChatScreenState.subAgentListener).toBe('function');

    act(() => {
      mockChatScreenState.subAgentListener?.(mockChatScreenState.activeSubAgents[0], 'completed');
      mockChatScreenState.subAgentListener?.(mockChatScreenState.activeSubAgents[1], 'completed');
    });

    await waitFor(() => {
      expect(mockSynthesizeAgentRunFinalAnswer).toHaveBeenCalledTimes(1);
    });

    act(() => {
      resolveFinalization?.({
        output: 'Synthesized final response',
        providerReplay: {
          openaiResponseOutput: [
            { id: 'final-output', type: 'message', role: 'assistant', content: [] },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(mockCompleteAgentRun).toHaveBeenCalledTimes(1);
    });

    expect(
      mockAddConversationLog.mock.calls.filter(
        ([, entry]) => entry.title === 'Background workers finished',
      ),
    ).toHaveLength(1);
  });

  it('appends a sub-agent started message to the parent conversation', () => {
    render(<ChatScreen />);

    expect(typeof mockChatScreenState.subAgentListener).toBe('function');

    act(() => {
      mockChatScreenState.subAgentListener?.(
        {
          sessionId: 'sub-2',
          parentConversationId: 'conv1',
          agentRunId: 'run-1',
          name: 'Backend Architect',
          depth: 1,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          status: 'running',
          sandboxPolicy: 'safe-only',
        },
        'started',
      );
    });

    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('Backend Architect'),
        subAgentEvent: expect.objectContaining({
          type: 'sub-agent',
          event: 'started',
          snapshot: expect.objectContaining({
            sessionId: 'sub-2',
            depth: 1,
            sandboxPolicy: 'safe-only',
          }),
        }),
      }),
    );
    expect(mockAddConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: expect.stringContaining('Backend Architect'),
        kind: 'system',
        level: 'info',
      }),
    );
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'work',
      expect.objectContaining({
        checkpointTitle: 'Worker started: Backend Architect',
      }),
      'run-1',
    );
  });

  it('opens a filtered worker detail view from a transcript sub-agent card', () => {
    const rootSnapshot = {
      sessionId: 'sub-root',
      parentConversationId: 'conv1',
      name: 'Planner',
      depth: 0,
      startedAt: Date.now() - 8000,
      updatedAt: Date.now(),
      status: 'running',
      sandboxPolicy: 'inherit',
      iterations: 1,
      toolsUsed: ['sessions_spawn'],
    };
    const childSnapshot = {
      sessionId: 'sub-child',
      parentConversationId: 'conv1',
      parentSessionId: 'sub-root',
      name: 'Implementer',
      depth: 1,
      startedAt: Date.now() - 5000,
      updatedAt: Date.now(),
      status: 'completed',
      sandboxPolicy: 'safe-only',
      output: 'Done.',
      iterations: 2,
      toolsUsed: ['read_file', 'file_edit'],
    };

    mockChatScreenState.activeSubAgents = [rootSnapshot, childSnapshot];
    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          { id: 'msg1', role: 'user', content: 'Run the workers', timestamp: Date.now() },
          {
            id: 'msg2',
            role: 'assistant',
            content: 'Planner started at depth 0 using inherit sandbox access.',
            timestamp: Date.now(),
            subAgentEvent: {
              type: 'sub-agent',
              event: 'started',
              snapshot: rootSnapshot,
            },
          },
        ],
      },
    ];

    const { getAllByText, getByTestId } = render(<ChatScreen />);

    fireEvent.press(getByTestId('sub-agent-open-details'));

    expect(getAllByText('Worker tree').length).toBeGreaterThan(0);
    expect(getAllByText('Planner').length).toBeGreaterThan(0);
    expect(getAllByText('Implementer').length).toBeGreaterThan(0);
    expect(getByTestId('sub-agent-rollup-card')).toBeTruthy();
  });

  it('keeps transcript-only nested workers in the detail modal after they leave the live registry', () => {
    const rootSnapshot = {
      sessionId: 'sub-root',
      parentConversationId: 'conv1',
      name: 'Planner',
      depth: 0,
      startedAt: Date.now() - 8000,
      updatedAt: Date.now(),
      status: 'completed',
      sandboxPolicy: 'inherit',
      iterations: 1,
      toolsUsed: ['sessions_spawn'],
    };
    const childSnapshot = {
      sessionId: 'sub-child',
      parentConversationId: 'conv1',
      parentSessionId: 'sub-root',
      name: 'Implementer',
      depth: 1,
      startedAt: Date.now() - 5000,
      updatedAt: Date.now(),
      status: 'completed',
      sandboxPolicy: 'safe-only',
      output: 'Done from transcript history.',
      iterations: 2,
      toolsUsed: ['read_file', 'file_edit'],
    };

    mockChatScreenState.activeSubAgents = [rootSnapshot];
    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          { id: 'msg1', role: 'user', content: 'Run the workers', timestamp: Date.now() },
          {
            id: 'msg2',
            role: 'assistant',
            content: 'Planner completed.',
            timestamp: Date.now(),
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: rootSnapshot,
            },
          },
          {
            id: 'msg3',
            role: 'assistant',
            content: 'Implementer completed.',
            timestamp: Date.now(),
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: childSnapshot,
            },
          },
        ],
      },
    ];

    const { getAllByTestId, getAllByText } = render(<ChatScreen />);

    fireEvent.press(getAllByTestId('sub-agent-open-details')[0]);

    expect(getAllByText('Worker tree').length).toBeGreaterThan(0);
    expect(getAllByText('Planner').length).toBeGreaterThan(0);
    expect(getAllByText('Implementer').length).toBeGreaterThan(0);
  });
});
