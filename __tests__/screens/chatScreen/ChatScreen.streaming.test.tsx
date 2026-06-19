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
import { createAgentRunControlGraphState } from '../../../testSupport/chatScreen/fixtures';
import {
  mockUpdateMessage,
  mockAddToolCall,
  mockSetAgentRunPhase,
  mockUpdateAgentRunPlan,
} from '../../../testSupport/chatScreen/storeMocks';
import { mockRunOrchestrator } from '../../../testSupport/chatScreen/serviceMocks';

describe('ChatScreen streaming presentation', () => {
  beforeEach(resetChatScreenTestEnvironment);
  afterEach(cleanupChatScreenTestEnvironment);

  it('throttles streamed token updates instead of writing every token', async () => {
    jest.useFakeTimers();

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Throttle test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    mockUpdateMessage.mockClear();

    const { act } = require('@testing-library/react-native');
    act(() => {
      for (let index = 0; index < 12; index += 1) {
        callbacks.onToken('a');
      }
    });

    expect(mockUpdateMessage).toHaveBeenCalledTimes(0);

    act(() => {
      jest.advanceTimersByTime(40);
    });

    expect(mockUpdateMessage).toHaveBeenCalledTimes(0);

    act(() => {
      jest.advanceTimersByTime(240);
    });

    expect(mockUpdateMessage).toHaveBeenCalledTimes(1);
    expect(mockUpdateMessage).toHaveBeenLastCalledWith('conv1', expect.any(String), 'aaaaaaaaaaaa');

    jest.useRealTimers();
  });

  it('shows the first streamed text token immediately and coalesces later UI updates', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Immediate token visibility');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onToken('Streaming');
    });

    expect(screen.getByText('Streaming')).toBeTruthy();

    act(() => {
      callbacks.onToken(' answer');
    });

    expect(screen.queryByText('Streaming answer')).toBeNull();

    act(() => {
      jest.advanceTimersByTime(48);
    });

    expect(screen.getByText('Streaming answer')).toBeTruthy();

    jest.useRealTimers();
  });

  it('shows the first visible streamed token immediately after hidden internal prefix tokens', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Hidden prefix handling');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onToken('Previous internal tool call: tool_catalog');
      callbacks.onToken(' (category="files").\n');
      jest.advanceTimersByTime(24);
    });

    expect(screen.queryByText(/Previous internal tool call:/)).toBeNull();

    act(() => {
      callbacks.onToken('Visible answer');
    });

    expect(screen.getByText('Visible answer')).toBeTruthy();

    jest.useRealTimers();
  });

  it('does not render a synthetic inline reasoning block before reasoning output arrives', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'No fake thinking');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    expect(screen.queryByTestId('assistant-inline-reasoning')).toBeNull();

    act(() => {
      callbacks.onStateChange('thinking');
    });

    expect(screen.queryByTestId('assistant-inline-reasoning')).toBeNull();
    expect(screen.getByLabelText('Assistant is typing')).toBeTruthy();

    jest.useRealTimers();
  });

  it('renders queued tool calls as soon as the assistant schedules them', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Queue the tool');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onAssistantMessage('Inspecting the repository.', [
        {
          id: 'tc-read',
          name: 'read_file',
          arguments: '{"path":"README.md"}',
          status: 'pending',
        },
      ]);
    });

    expect(screen.queryByText('Inspecting the repository.')).toBeNull();
    expect(screen.getByText('Read File')).toBeTruthy();
    expect(mockAddToolCall).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      expect.objectContaining({
        id: 'tc-read',
        name: 'read_file',
        status: 'pending',
      }),
    );

    jest.useRealTimers();
  });

  it('renders streamed tool_call events immediately before the assistant turn finalizes', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(
      screen.getByPlaceholderText('Message...'),
      'Show queued tools immediately',
    );
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onToolCallQueued({
        id: 'tc-read-stream',
        name: 'read_file',
        arguments: '{"path":"README.md"}',
        status: 'pending',
      });
    });

    expect(screen.getByText('Read File')).toBeTruthy();
    expect(mockAddToolCall).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('clears the live streamed draft when the orchestrator resets the current turn', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Reset the current turn');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onToken('Discarded answer');
      callbacks.onToolCallQueued({
        id: 'tc-reset',
        name: 'read_file',
        arguments: '{"path":"README.md"}',
        status: 'pending',
      });
    });

    expect(screen.getByText('Discarded answer')).toBeTruthy();
    expect(screen.getByText('Read File')).toBeTruthy();

    act(() => {
      callbacks.onAssistantStreamReset?.();
    });

    expect(screen.queryByText('Discarded answer')).toBeNull();
    expect(screen.queryByText('Read File')).toBeNull();

    jest.useRealTimers();
  });

  it('does not project graph goals into the visible plan from streamed assistant prose', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Capture the plan');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onToken('Objective: Audit the repository\n');
      callbacks.onToken('Success Criteria:\n- Verify the fix\n');
      callbacks.onToken('Workstreams:\n1. Inspect | Goal: Find the root cause');
      jest.advanceTimersByTime(24);
    });

    expect(mockUpdateAgentRunPlan).not.toHaveBeenCalled();

    act(() => {
      callbacks.onAgentControlGraphStateChange?.(
        createAgentRunControlGraphState({
          goals: [
            {
              id: 'inspect',
              title: 'Inspect repository',
              description: 'Find the root cause',
              status: 'active',
              dependencies: [],
              evidence: [],
              createdAt: 1_700_000_000_000,
              updatedAt: 1_700_000_000_100,
            },
          ],
          updatedAt: 1_700_000_000_100,
        }),
      );
    });

    expect(mockUpdateAgentRunPlan).not.toHaveBeenCalled();
    expect(mockSetAgentRunPhase).not.toHaveBeenCalledWith(
      'conv1',
      'plan',
      expect.anything(),
      'run-1',
    );

    jest.useRealTimers();
  });

  it('strips internal Gemini tool-history lines before storing assistant content', async () => {
    jest.useFakeTimers();

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Sanitize output');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    mockUpdateMessage.mockClear();
    const { act } = require('@testing-library/react-native');

    act(() => {
      callbacks.onAssistantMessage(
        [
          'Previous internal tool call: tool_catalog (category="files").',
          'Previous internal tool result: tool_catalog returned with structured tool catalog data.',
          'Answer after the failed tool.',
        ].join('\n'),
        [],
      );
    });

    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      'Answer after the failed tool.',
    );

    jest.useRealTimers();
  });
});
