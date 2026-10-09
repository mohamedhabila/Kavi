import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ChatInput } from '../../src/components/chat/ChatInput';

jest.mock('../../src/components/chat/useChatVoiceRecorder', () => ({
  useChatVoiceRecorder: () => ({
    phase: 'idle',
    isActive: false,
    isRecording: false,
    isTranscribing: false,
    isCancelling: false,
    elapsedMs: 0,
    waveformLevels: [],
    errorMessage: null,
    clearError: jest.fn(),
    pressableHandlers: {
      onPressIn: jest.fn(),
      onPressOut: jest.fn(),
      onTouchMove: jest.fn(),
      onTouchCancel: jest.fn(),
    },
  }),
}));

jest.mock('../../src/components/chat/VoiceRecorderOverlay', () => ({
  VoiceRecorderOverlay: () => null,
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      mode: 'dark',
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
      border: '#333',
      subtleBorder: '#444',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#030',
      danger: '#f00',
      dangerSoft: '#300',
      inputBackground: '#222',
      inputBorder: '#444',
      overlay: 'rgba(0,0,0,0.6)',
    },
  }),
}));

const createProps = (
  overrides: Partial<React.ComponentProps<typeof ChatInput>> = {},
): React.ComponentProps<typeof ChatInput> => ({
  onSend: jest.fn(),
  onStop: jest.fn(),
  isLoading: false,
  exactText: false,
  text: '',
  onChangeExactText: jest.fn(),
  onChangeText: jest.fn(),
  attachments: [],
  onChangeAttachments: jest.fn(),
  ...overrides,
});

// While the assistant works, the composer keeps Stop reachable and still sends: a message
// sent then waits for the assistant's next step, listed above the composer until read.

describe('ChatInput while the assistant works', () => {
  it('offers only Stop when there is nothing to send', () => {
    const screen = render(<ChatInput {...createProps({ isLoading: true })} />);

    expect(screen.getByTestId('chat-stop-button')).toBeTruthy();
    expect(screen.queryByTestId('chat-send-button')).toBeNull();
  });

  it('offers Stop and Send once there is a draft, and sends it', () => {
    const onSend = jest.fn();
    const onStop = jest.fn();
    const screen = render(
      <ChatInput
        {...createProps({ isLoading: true, text: 'Make it vegetarian.', onSend, onStop })}
      />,
    );

    fireEvent.press(screen.getByTestId('chat-send-button'));
    fireEvent.press(screen.getByTestId('chat-stop-button'));

    expect(onSend).toHaveBeenCalledWith('Make it vegetarian.', undefined);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('lists the messages waiting for the assistant and edits one', () => {
    const onEditQueuedMessage = jest.fn();
    const screen = render(
      <ChatInput
        {...createProps({
          isLoading: true,
          queuedMessages: [
            { id: 'steer-1', text: 'Make it vegetarian.' },
            { id: 'steer-2', text: 'And under 30 euros.' },
          ],
          onEditQueuedMessage,
        })}
      />,
    );

    expect(screen.getByText('Make it vegetarian.')).toBeTruthy();
    expect(screen.getByText('And under 30 euros.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('chat-queued-message-edit-steer-2'));
    expect(onEditQueuedMessage).toHaveBeenCalledWith('steer-2');
  });

  it('shows no waiting list when nothing is queued', () => {
    const screen = render(
      <ChatInput {...createProps({ queuedMessages: [], onEditQueuedMessage: jest.fn() })} />,
    );

    expect(screen.queryByTestId('chat-queued-messages')).toBeNull();
    expect(screen.queryByTestId('chat-stop-button')).toBeNull();
    expect(screen.getByTestId('chat-send-button')).toBeTruthy();
  });
});
