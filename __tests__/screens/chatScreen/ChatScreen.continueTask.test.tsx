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
import { mockAddMessage } from '../../../testSupport/chatScreen/storeMocks';
import { mockRunOrchestrator } from '../../../testSupport/chatScreen/serviceMocks';
import { createDefaultConversations } from '../../../testSupport/chatScreen/fixtures';

// A task the assistant handed back unfinished is carried on with one tap: the person no
// longer has to type how they would like it to continue.

function conversationEndingWith(finishReason: string) {
  const conversation = createDefaultConversations()[0];
  return [
    {
      ...conversation,
      messages: [
        conversation.messages[0],
        {
          id: 'stopped',
          role: 'assistant',
          content: 'I reached the most steps I can take at once.',
          timestamp: Date.now(),
          assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason },
        },
      ],
    },
  ];
}

describe('ChatScreen continue', () => {
  beforeEach(resetChatScreenTestEnvironment);
  afterEach(cleanupChatScreenTestEnvironment);

  it('continues a task stopped at its step limit with one tap', async () => {
    mockChatScreenState.conversations = conversationEndingWith('max_iterations');
    const screen = render(<ChatScreen />);

    await act(async () => {
      fireEvent.press(await screen.findByTestId('assistant-continue-task'));
    });

    await waitFor(() =>
      expect(mockAddMessage).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          role: 'user',
          content: 'Please continue with the task from where you stopped.',
        }),
      ),
    );
  });

  it('offers it once the run that stopped is no longer busy', async () => {
    let finishRun: (value: { terminalDisposition: 'final_candidate' }) => void = () => {};
    mockRunOrchestrator.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRun = resolve;
        }),
    );
    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Sort my photos by trip');
    fireEvent.press(screen.getByTestId('chat-send-button'));
    await waitFor(() => expect(mockRunOrchestrator).toHaveBeenCalledTimes(1));

    // The stopped answer lands while the request is still in flight.
    mockChatScreenState.conversations = conversationEndingWith('max_iterations');
    screen.rerender(<ChatScreen />);
    expect(screen.queryByTestId('assistant-continue-task')).toBeNull();

    // The request then settles with the transcript unchanged; the list must still update.
    await act(async () => {
      finishRun({ terminalDisposition: 'final_candidate' });
    });

    expect(await screen.findByTestId('assistant-continue-task')).toBeTruthy();
  });

  it('offers nothing on a finished answer', () => {
    mockChatScreenState.conversations = conversationEndingWith('stop');
    const screen = render(<ChatScreen />);

    expect(screen.queryByTestId('assistant-continue-task')).toBeNull();
  });
});
