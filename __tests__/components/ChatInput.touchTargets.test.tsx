import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
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
    },
  }),
}));

const createProps = (
  overrides: Partial<React.ComponentProps<typeof ChatInput>> = {},
): React.ComponentProps<typeof ChatInput> => ({
  onSend: jest.fn(),
  onStop: jest.fn(),
  isLoading: false,
  text: '',
  onChangeText: jest.fn(),
  attachments: [],
  onChangeAttachments: jest.fn(),
  ...overrides,
});

describe('ChatInput touch targets', () => {
  it('uses mobile-sized touch targets for primary composer controls', () => {
    const { getByLabelText, getByTestId } = render(<ChatInput {...createProps()} />);

    const attachButtonStyle = StyleSheet.flatten(getByLabelText('Attach file').props.style);
    const voiceButtonStyle = StyleSheet.flatten(getByTestId('chat-voice-button').props.style);
    const sendButtonStyle = StyleSheet.flatten(getByLabelText('Send message').props.style);

    expect(attachButtonStyle).toEqual(expect.objectContaining({ minWidth: 44, minHeight: 44 }));
    expect(voiceButtonStyle).toEqual(expect.objectContaining({ minWidth: 44, minHeight: 44 }));
    expect(sendButtonStyle).toEqual(expect.objectContaining({ minWidth: 44, minHeight: 44 }));
  });
});
