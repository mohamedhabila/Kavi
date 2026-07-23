import {
  act,
  fireEvent,
  FlatList,
  render,
  ChatScreen,
} from '../../../testSupport/chatScreen/runtime';
import {
  cleanupChatScreenTestEnvironment,
  resetChatScreenTestEnvironment,
} from '../../../testSupport/chatScreen/mockDefaults';
import { mockChatScreenState } from '../../../testSupport/chatScreen/state';
import { createDefaultConversations } from '../../../testSupport/chatScreen/fixtures';
import { mockNavigate, mockOpenDrawer } from '../../../testSupport/chatScreen/componentMocks';
import { mockGetOrCreateCanonicalThread } from '../../../testSupport/chatScreen/storeMocks';

describe('ChatScreen rendering and layout', () => {
  beforeEach(resetChatScreenTestEnvironment);
  afterEach(cleanupChatScreenTestEnvironment);

  it('renders the chat screen', () => {
    const { getByText } = render(<ChatScreen />);
    expect(getByText('Hello')).toBeTruthy();
    expect(getByText('Hi there!')).toBeTruthy();
  });

  it('bootstraps the canonical conversation when no conversation is active', () => {
    mockChatScreenState.activeConversationId = null;
    render(<ChatScreen />);
    expect(mockGetOrCreateCanonicalThread).toHaveBeenCalledWith(
      'openai',
      'You are helpful',
      'gpt-5.4',
      {
        activate: undefined,
        personaId: 'super-agent',
        mode: 'agentic',
      },
    );
  });

  it('opens drawer when menu is pressed', () => {
    const { getByTestId } = render(<ChatScreen />);
    const menuIcon = getByTestId('icon-Menu');
    fireEvent.press(menuIcon.parent || menuIcon);
    expect(mockOpenDrawer).toHaveBeenCalled();
  });

  it('moves model selection behind conversation settings', () => {
    const { getByTestId, queryByText } = render(<ChatScreen />);

    expect(queryByText('gpt-5.4')).toBeNull();
    fireEvent.press(getByTestId('chat-open-conversation-options'));
    fireEvent.press(getByTestId('chat-open-conversation-settings'));

    expect(mockNavigate).toHaveBeenCalledWith('ConversationSettings', {
      conversationId: 'conv1',
      returnTo: { name: 'Chat' },
    });
  });

  it('keeps telemetry out of chat and opens detailed usage in two taps', () => {
    const { getByTestId, queryByTestId } = render(<ChatScreen />);

    expect(queryByTestId('chat-usage-strip')).toBeNull();
    fireEvent.press(getByTestId('chat-open-conversation-options'));
    fireEvent.press(getByTestId('chat-open-usage'));

    expect(mockNavigate).toHaveBeenCalledWith('ConversationSettings', {
      conversationId: 'conv1',
      returnTo: { name: 'Chat' },
      showUsage: true,
    });
  });

  it('mounts the inline workflow widget for persisted agent runs', () => {
    jest.useFakeTimers();

    const conversation = createDefaultConversations()[0];
    mockChatScreenState.conversations = [
      {
        ...conversation,
        messages: conversation.messages.map((message: any) =>
          message.id === 'msg2'
            ? {
                ...message,
                content: 'Still verifying the worker output.',
                assistantMetadata: {
                  kind: 'intermediate',
                  completionStatus: 'complete',
                  finishReason: 'tool_calls',
                },
              }
            : message,
        ),
        activeAgentRunId: 'run-1',
        agentRuns: [
          {
            id: 'run-1',
            userMessageId: 'msg1',
            goal: 'Audit the repository and apply the fix.',
            status: 'running',
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_500,
            currentPhase: 'review',
            latestSummary: 'Still verifying the worker output.',
            plan: {
              objective: 'Audit the repository and apply the fix.',
              successCriteria: [
                'The workflow state is persisted.',
                'The workflow card shows the latest timeline.',
              ],
              stopConditions: [
                'Stop when the fix is verified.',
                'Stop if a concrete blocker remains unresolved.',
              ],
              workstreams: [
                {
                  id: 'ws-1',
                  title: 'Repository audit',
                  goal: 'Inspect the current agentic workflow implementation',
                },
                {
                  id: 'ws-2',
                  title: 'UI update',
                  goal: 'Render the workflow card timeline',
                },
              ],
              updatedAt: 1_700_000_000_150,
            },
            summary: {
              assistantTurns: 2,
              startedTools: 2,
              completedTools: 2,
              failedTools: 0,
              spawnedSubAgents: 1,
              durationMs: 12_000,
            },
            phases: [
              { key: 'assess', title: 'Assess', status: 'completed', updatedAt: 1_700_000_000_100 },
              {
                key: 'plan',
                title: 'Plan',
                status: 'completed',
                detail: 'Inspect, patch, and verify.',
                updatedAt: 1_700_000_000_150,
              },
              { key: 'work', title: 'Work', status: 'completed', updatedAt: 1_700_000_000_200 },
              { key: 'review', title: 'Review', status: 'active', updatedAt: 1_700_000_000_400 },
              { key: 'deliver', title: 'Deliver', status: 'pending', updatedAt: 1_700_000_000_500 },
            ],
            controlGraph: {
              version: 1,
              status: 'ready',
              iteration: 2,
              goals: [
                {
                  id: 'goal-audit',
                  title: 'Audit the repository',
                  status: 'active',
                  dependencies: [],
                  evidence: ['read_file'],
                  createdAt: 1,
                  updatedAt: 2,
                },
              ],
              expectedToolCalls: [],
              observedToolResults: [],
              pendingAsyncCount: 0,
              lastModelToolNames: [],
              turnDirectives: {
                forceFinalText: false,
                requireDelegationTool: false,
                requireWorkflowTool: false,
                incompleteFinalTextRecoveryCount: 0,
              },
              audit: [],
              updatedAt: 2,
              asyncWork: {
                awaitingBackgroundWorkers: false,
                pendingOperations: [],
                updatedAt: 2,
              },
            },
            checkpoints: [
              {
                id: 'cp-1',
                timestamp: 1_700_000_000_000,
                kind: 'run',
                title: 'Turn started',
                detail: 'Audit the repository and apply the fix.',
              },
              {
                id: 'cp-1b',
                timestamp: 1_700_000_000_100,
                kind: 'tool',
                title: 'Tool started: read_file',
                detail: '{"path":"src/store/useChatStore.ts"}',
              },
              {
                id: 'cp-2',
                timestamp: 1_700_000_000_500,
                kind: 'sub-agent',
                title: 'Worker completed: Backend Architect',
                detail: 'Worker completed the repository scan.',
              },
            ],
          },
        ],
      },
    ];

    try {
      const { getByTestId, queryByTestId } = render(<ChatScreen />);

      act(() => {
        jest.runOnlyPendingTimers();
      });

      expect(queryByTestId('agent-run-card')).toBeNull();
      expect(getByTestId('agent-goals-widget')).toBeTruthy();
      expect(queryByTestId('agent-goals-details')).toBeNull();
    } finally {
      act(() => {
        jest.runOnlyPendingTimers();
      });
      jest.useRealTimers();
    }
  });

  it('renders message input', () => {
    const { getByPlaceholderText } = render(<ChatScreen />);
    expect(getByPlaceholderText('Message...')).toBeTruthy();
  });

  it('relies on native keyboard behavior for the chat body', () => {
    const { UNSAFE_getByType, queryByTestId } = render(<ChatScreen />);

    expect(queryByTestId('chat-composer-keyboard-avoider')).toBeNull();
    expect(UNSAFE_getByType(FlatList).props.keyboardShouldPersistTaps).toBeUndefined();
    expect(UNSAFE_getByType(FlatList).props.keyboardDismissMode).toBeUndefined();
  });

  it('mounts only the recent transcript window and expands earlier history on demand', () => {
    const longMessages = Array.from({ length: 60 }, (_, index) => {
      const turn = index + 1;
      return [
        {
          id: `user-${turn}`,
          role: 'user',
          content: `Question ${turn}`,
          timestamp: 1_700_000_000_000 + turn * 2,
        },
        {
          id: `assistant-${turn}`,
          role: 'assistant',
          content: `Answer ${turn}`,
          timestamp: 1_700_000_000_001 + turn * 2,
        },
      ];
    }).flat();
    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        messages: longMessages,
      },
    ];
    const scrollToEndSpy = jest
      .spyOn((FlatList as any).prototype, 'scrollToEnd')
      .mockImplementation(() => {});

    try {
      const { UNSAFE_getByType, getByTestId, queryByTestId } = render(<ChatScreen />);
      const messageList = UNSAFE_getByType(FlatList);

      expect(messageList.props.data).toHaveLength(80);
      expect(messageList.props.data[0].resolvedMessage.content).toBe('Question 21');
      expect(messageList.props.data.at(-1).resolvedMessage.content).toBe('Answer 60');
      expect(getByTestId('chat-show-earlier-messages')).toBeTruthy();

      scrollToEndSpy.mockClear();
      fireEvent.press(getByTestId('chat-show-earlier-messages'));

      const expandedMessageList = UNSAFE_getByType(FlatList);
      expect(expandedMessageList.props.data).toHaveLength(120);
      expect(expandedMessageList.props.data[0].resolvedMessage.content).toBe('Question 1');
      expect(queryByTestId('chat-show-earlier-messages')).toBeNull();
      expect(scrollToEndSpy).not.toHaveBeenCalled();
    } finally {
      scrollToEndSpy.mockRestore();
    }
  });

  it('renders the guided assistant start while the canonical conversation is being materialized', () => {
    mockChatScreenState.activeConversationId = null;
    const { getByTestId, getByText } = render(<ChatScreen />);

    expect(getByTestId('assistant-start')).toBeTruthy();
    expect(getByText('How can I help?')).toBeTruthy();
    expect(getByText('Ask & understand')).toBeTruthy();
  });
});
