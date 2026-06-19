import React from 'react';
import { render, within } from '@testing-library/react-native';
import { FlatList, StyleSheet } from 'react-native';
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

describe('ChatInput composer refinement', () => {
  it('uses a bounded mobile command suggestion list with a selected first command', () => {
    const screen = render(<ChatInput {...createProps({ text: '/' })} />);
    const list = screen.UNSAFE_getByType(FlatList);
    const selectedCommand = screen.getByTestId('chat-command-suggestion-new');
    const nextCommand = screen.getByTestId('chat-command-suggestion-reset');

    expect(StyleSheet.flatten(screen.getByTestId('chat-command-suggestions').props.style)).toEqual(
      expect.objectContaining({ maxHeight: 224 }),
    );
    expect(StyleSheet.flatten(list.props.style)).toEqual(
      expect.objectContaining({ maxHeight: 224 }),
    );
    expect(list.props.keyboardShouldPersistTaps).toBe('always');
    expect(list.props.scrollEnabled).toBe(true);

    expect(StyleSheet.flatten(selectedCommand.props.style)).toEqual(
      expect.objectContaining({
        minHeight: 56,
        backgroundColor: '#030',
        borderLeftColor: '#0f0',
      }),
    );
    expect(selectedCommand.props.accessibilityState).toEqual({
      disabled: false,
      selected: true,
    });
    expect(nextCommand.props.accessibilityState).toEqual({
      disabled: false,
      selected: false,
    });
  });

  it('keeps composer actions in the native input row and bounds text growth', () => {
    const screen = render(<ChatInput {...createProps()} />);
    const composerRow = screen.getByTestId('chat-composer-row');
    const rowQueries = within(composerRow);
    const inputStyle = StyleSheet.flatten(screen.getByTestId('chat-composer-input').props.style);

    expect(rowQueries.getByTestId('chat-attach-button')).toBeTruthy();
    expect(rowQueries.getByTestId('chat-voice-button')).toBeTruthy();
    expect(rowQueries.getByTestId('chat-composer-input')).toBeTruthy();
    expect(rowQueries.getByTestId('chat-send-button')).toBeTruthy();
    expect(inputStyle).toEqual(expect.objectContaining({ minHeight: 44, maxHeight: 120 }));
    expect(screen.queryByTestId('chat-composer-keyboard-avoider')).toBeNull();
  });
});
