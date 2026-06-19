import { act, render, waitFor, ChatScreen } from '../../../testSupport/chatScreen/runtime';
import {
  cleanupChatScreenTestEnvironment,
  resetChatScreenTestEnvironment,
} from '../../../testSupport/chatScreen/mockDefaults';
import { mockChatScreenState } from '../../../testSupport/chatScreen/state';
import { createDefaultConversations } from '../../../testSupport/chatScreen/fixtures';
import {
  mockSetAgentRunPhase,
  mockUpdateAgentRunSummary,
} from '../../../testSupport/chatScreen/storeMocks';

describe('ChatScreen sub-agent progress', () => {
  beforeEach(resetChatScreenTestEnvironment);

  afterEach(cleanupChatScreenTestEnvironment);

  it('refreshes transcript worker cards when live progress arrives', async () => {
    jest.useFakeTimers();

    const rootSnapshot = {
      sessionId: 'sub-root',
      parentConversationId: 'conv1',
      name: 'Planner',
      depth: 0,
      startedAt: Date.now() - 8000,
      updatedAt: Date.now() - 4000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };

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

    const { getByText } = render(<ChatScreen />);

    await waitFor(() => {
      expect(typeof mockChatScreenState.subAgentListener).toBe('function');
    });

    mockChatScreenState.activeSubAgents = [
      {
        ...rootSnapshot,
        agentRunId: 'run-1',
        updatedAt: Date.now(),
        currentActivity: 'Reading repository files',
        activeToolName: 'read_file',
      },
    ];

    act(() => {
      mockChatScreenState.subAgentListener?.(mockChatScreenState.activeSubAgents[0], 'progress');
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(getByText('Reading repository files')).toBeTruthy();
      expect(getByText('read_file')).toBeTruthy();
    });
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'work',
      expect.objectContaining({
        detail: 'Reading repository files',
      }),
      'run-1',
    );

    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('coalesces rapid worker status updates into one throttled transcript refresh', async () => {
    jest.useFakeTimers();

    const rootSnapshot = {
      sessionId: 'sub-root',
      parentConversationId: 'conv1',
      name: 'Planner',
      depth: 0,
      startedAt: Date.now() - 8000,
      updatedAt: Date.now() - 4000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };

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

    const { getByText, queryByText } = render(<ChatScreen />);

    await waitFor(() => {
      expect(typeof mockChatScreenState.subAgentListener).toBe('function');
    });

    mockChatScreenState.activeSubAgents = [
      {
        ...rootSnapshot,
        updatedAt: Date.now(),
        currentActivity: 'Scanning repository files',
        activeToolName: 'read_file',
      },
    ];

    act(() => {
      mockChatScreenState.subAgentListener?.(mockChatScreenState.activeSubAgents[0], 'progress');
    });

    mockChatScreenState.activeSubAgents = [
      {
        ...rootSnapshot,
        updatedAt: Date.now() + 1,
        currentActivity: 'Comparing symbol usage',
        activeToolName: 'text_search',
      },
    ];

    act(() => {
      mockChatScreenState.subAgentListener?.(mockChatScreenState.activeSubAgents[0], 'progress');
    });

    expect(queryByText('Comparing symbol usage')).toBeNull();

    act(() => {
      jest.advanceTimersByTime(399);
    });

    expect(queryByText('Comparing symbol usage')).toBeNull();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    await waitFor(() => {
      expect(getByText('Comparing symbol usage')).toBeTruthy();
    });
    expect(queryByText('Scanning repository files')).toBeNull();
    expect(getByText('text_search')).toBeTruthy();

    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('coalesces rapid worker status updates into one workflow store update', async () => {
    jest.useFakeTimers();

    const rootSnapshot = {
      sessionId: 'sub-root',
      parentConversationId: 'conv1',
      name: 'Planner',
      depth: 0,
      startedAt: Date.now() - 8000,
      updatedAt: Date.now() - 4000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };

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

    render(<ChatScreen />);

    await waitFor(() => {
      expect(typeof mockChatScreenState.subAgentListener).toBe('function');
    });

    mockSetAgentRunPhase.mockClear();
    mockUpdateAgentRunSummary.mockClear();

    mockChatScreenState.activeSubAgents = [
      {
        ...rootSnapshot,
        agentRunId: 'run-1',
        updatedAt: Date.now(),
        currentActivity: 'Scanning repository files',
        activeToolName: 'read_file',
      },
    ];

    act(() => {
      mockChatScreenState.subAgentListener?.(mockChatScreenState.activeSubAgents[0], 'progress');
    });

    mockChatScreenState.activeSubAgents = [
      {
        ...rootSnapshot,
        agentRunId: 'run-1',
        updatedAt: Date.now() + 1,
        currentActivity: 'Comparing symbol usage',
        activeToolName: 'text_search',
      },
    ];

    act(() => {
      mockChatScreenState.subAgentListener?.(mockChatScreenState.activeSubAgents[0], 'progress');
    });

    expect(mockSetAgentRunPhase).not.toHaveBeenCalled();
    expect(mockUpdateAgentRunSummary).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(mockSetAgentRunPhase).toHaveBeenCalledTimes(1);
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'work',
      expect.objectContaining({
        detail: 'Comparing symbol usage',
      }),
      'run-1',
    );
    expect(mockUpdateAgentRunSummary).toHaveBeenCalledTimes(1);
    expect(mockUpdateAgentRunSummary).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        latestSummary: 'Comparing symbol usage',
      }),
      'run-1',
    );

    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });
});
