import {
  act,
  fireEvent,
  FlatList,
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
  mockAddMessage,
  mockUpdateMessage,
  mockAddToolCall,
  mockUpdateToolCallStatus,
} from '../../../testSupport/chatScreen/storeMocks';
import { mockRunOrchestrator } from '../../../testSupport/chatScreen/serviceMocks';

describe('ChatScreen sub-agent worker loop', () => {
  beforeEach(resetChatScreenTestEnvironment);

  afterEach(cleanupChatScreenTestEnvironment);

  it('handles a Claude-style worker loop through the parent conversation path', async () => {
    jest.useFakeTimers();

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Investigate the repo with a worker');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    const workerSnapshot = {
      sessionId: 'sub-claude',
      parentConversationId: 'conv1',
      name: 'Claude Researcher',
      depth: 0,
      startedAt: Date.now() - 3000,
      updatedAt: Date.now() - 1000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };

    await act(async () => {
      callbacks.onAssistantMessage('I am delegating the repository audit to a Claude worker.', [
        {
          id: 'tc-spawn',
          name: 'sessions_spawn',
          arguments: '{"prompt":"Audit the repository","name":"Claude Researcher"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-spawn',
        name: 'sessions_spawn',
        arguments: '{"prompt":"Audit the repository","name":"Claude Researcher"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-spawn',
        name: 'sessions_spawn',
        arguments: '{"prompt":"Audit the repository","name":"Claude Researcher"}',
        status: 'completed',
        result: JSON.stringify({ status: 'running', sessionId: 'sub-claude' }),
      });

      mockChatScreenState.subAgentListener?.(workerSnapshot, 'started');

      mockChatScreenState.activeSubAgents = [
        {
          ...workerSnapshot,
          updatedAt: Date.now(),
          currentActivity: 'Inspecting repository files',
          activeToolName: 'read_file',
        },
      ];
      mockChatScreenState.subAgentListener?.(mockChatScreenState.activeSubAgents[0], 'progress');
      jest.advanceTimersByTime(400);

      callbacks.onAssistantMessage('Checking the Claude worker status.', [
        {
          id: 'tc-status',
          name: 'sessions_status',
          arguments: '{"sessionId":"sub-claude"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-status',
        name: 'sessions_status',
        arguments: '{"sessionId":"sub-claude"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-status',
        name: 'sessions_status',
        arguments: '{"sessionId":"sub-claude"}',
        status: 'completed',
        result: JSON.stringify({
          status: 'completed',
          sessionId: 'sub-claude',
          outputPreview: 'Claude verified the repository findings.',
        }),
      });

      mockChatScreenState.subAgentListener?.(
        {
          ...workerSnapshot,
          updatedAt: Date.now() + 1,
          status: 'completed',
          output: 'Claude verified the repository findings.',
          toolsUsed: ['read_file', 'text_search'],
          iterations: 2,
        },
        'completed',
      );

      callbacks.onToken('The Claude worker verified the repository findings.');
      jest.advanceTimersByTime(240);
      callbacks.onAssistantMessage('The Claude worker verified the repository findings.', []);
      callbacks.onDone();
      await Promise.resolve();
    });

    expect(mockAddToolCall).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      expect.objectContaining({ name: 'sessions_spawn' }),
    );
    expect(mockAddToolCall).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      expect.objectContaining({ name: 'sessions_status' }),
    );
    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        subAgentEvent: expect.objectContaining({
          event: 'started',
          snapshot: expect.objectContaining({ sessionId: 'sub-claude', status: 'running' }),
        }),
      }),
    );
    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        subAgentEvent: expect.objectContaining({
          event: 'completed',
          snapshot: expect.objectContaining({
            sessionId: 'sub-claude',
            status: 'completed',
            output: 'Claude verified the repository findings.',
          }),
        }),
      }),
    );
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      'The Claude worker verified the repository findings.',
    );

    jest.useRealTimers();
  });

  it('surfaces worker output into a separate assistant message and suppresses duplicate late text', async () => {
    jest.useFakeTimers();

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Use the worker result directly');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    await act(async () => {
      callbacks.onAssistantMessage('I will surface the worker answer.', [
        {
          id: 'tc-surface',
          name: 'sessions_surface_output',
          arguments: '{"sessionId":"sub-surface"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-surface',
        name: 'sessions_surface_output',
        arguments: '{"sessionId":"sub-surface"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-surface',
        name: 'sessions_surface_output',
        arguments: '{"sessionId":"sub-surface"}',
        status: 'completed',
        result: JSON.stringify({
          status: 'surfaced',
          sessionId: 'sub-surface',
          output: 'Worker-authored final answer',
          outputLength: 26,
          sourceOutputLength: 26,
          selectionApplied: false,
          usedFullOutput: true,
          guidance:
            'This output is intended to be surfaced directly to the user by the runtime. Do not restate the same content in assistant text unless you are adding materially new information.',
        }),
      });
      callbacks.onToolMessage('tc-surface', 'tool result');
      callbacks.onToken('Worker-authored final answer');
      callbacks.onAssistantMessage('Worker-authored final answer', []);
      callbacks.onDone();
      await Promise.resolve();
    });

    const surfacedAssistantMessages = mockAddMessage.mock.calls.filter(
      ([conversationId, message]) =>
        conversationId === 'conv1' &&
        message.role === 'assistant' &&
        message.content === 'Worker-authored final answer',
    );

    expect(surfacedAssistantMessages).toHaveLength(1);
    expect(surfacedAssistantMessages[0][1]).toEqual(
      expect.objectContaining({
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'surfaced_worker_output_pending',
        }),
      }),
    );
    expect(mockUpdateToolCallStatus).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      'tc-surface',
      'completed',
      expect.objectContaining({
        result:
          'Full worker output from sub-surface was surfaced to the user in the assistant response.',
      }),
    );
    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        role: 'tool',
        content:
          'Full worker output from sub-surface was surfaced to the user in the assistant response.',
        toolCallId: 'tc-surface',
      }),
    );
    expect(mockUpdateMessage).not.toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      'Worker-authored final answer',
    );

    jest.useRealTimers();
  });

  it('does not auto-follow while the user is actively dragging the conversation', async () => {
    const scrollToEndSpy = jest
      .spyOn((FlatList as any).prototype, 'scrollToEnd')
      .mockImplementation(() => {});
    const { UNSAFE_getByType, getByPlaceholderText, getByTestId } = render(<ChatScreen />);

    fireEvent.changeText(getByPlaceholderText('Message...'), 'Keep streaming');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    scrollToEndSpy.mockClear();

    const messageList = UNSAFE_getByType(FlatList);

    const { act } = require('@testing-library/react-native');
    act(() => {
      messageList.props.onScrollBeginDrag?.();
      messageList.props.onContentSizeChange?.(400, 1800);
    });

    expect(scrollToEndSpy).not.toHaveBeenCalled();

    scrollToEndSpy.mockRestore();
  });

  it('handles orchestrator error callback', async () => {
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onError(new Error('Test error'));
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Error test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockUpdateMessage).toHaveBeenCalledWith(
        'conv1',
        expect.any(String),
        'Error: Test error',
      );
    });
  });
});
