// ---------------------------------------------------------------------------
// Tests — ChatInput Component
// ---------------------------------------------------------------------------

import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import renderer from 'react-test-renderer';
import { ChatInput } from '../../src/components/chat/ChatInput';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Attachment } from '../../src/types/attachment';

const mockUseChatVoiceRecorder = jest.fn();
const mockVoiceRecorderOverlay = jest.fn();

jest.mock('../../src/components/chat/useChatVoiceRecorder', () => ({
  useChatVoiceRecorder: (options: unknown) => mockUseChatVoiceRecorder(options),
}));

jest.mock('../../src/components/chat/VoiceRecorderOverlay', () => {
  const React = require('react');
  const { Text } = require('react-native');

  return {
    VoiceRecorderOverlay: (props: { title: string }) => {
      mockVoiceRecorderOverlay(props);
      return React.createElement(Text, { testID: 'mock-voice-overlay' }, props.title);
    },
  };
});

// Mock theme
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
      inputBackground: '#222',
      inputBorder: '#444',
    },
  }),
  AppPalette: {},
}));

type VoiceRecorderOptions = {
  disabled?: boolean;
  messages: {
    noSpeechDetected: string;
    microphonePermissionDenied: string;
    genericFailure: string;
  };
  onVoiceNoteReady: (payload: {
    transcript: string;
    attachment: Attachment;
  }) => Promise<void> | void;
};

type MockVoiceRecorderState = {
  phase: 'idle' | 'starting' | 'recording' | 'transcribing';
  isActive: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  isCancelling: boolean;
  elapsedMs: number;
  waveformLevels: number[];
  errorMessage: string | null;
  clearError: jest.Mock;
  pressableHandlers: {
    onPressIn: jest.Mock;
    onPressOut: jest.Mock;
    onTouchMove: jest.Mock;
    onTouchCancel: jest.Mock;
  };
};

const createVoiceRecorderState = (
  overrides: Partial<MockVoiceRecorderState> = {},
): MockVoiceRecorderState => ({
  phase: 'idle',
  isActive: false,
  isRecording: false,
  isTranscribing: false,
  isCancelling: false,
  elapsedMs: 0,
  waveformLevels: [0.2, 0.4, 0.3],
  errorMessage: null,
  clearError: jest.fn(),
  pressableHandlers: {
    onPressIn: jest.fn(),
    onPressOut: jest.fn(),
    onTouchMove: jest.fn(),
    onTouchCancel: jest.fn(),
  },
  ...overrides,
});

describe('ChatInput', () => {
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

  const renderControlledChatInput = (
    overrides: Partial<React.ComponentProps<typeof ChatInput>> = {},
  ) => {
    const props = createProps(overrides);

    const ControlledChatInput = () => {
      const [text, setText] = React.useState(props.text);
      const [attachments, setAttachments] = React.useState(props.attachments);

      return (
        <ChatInput
          {...props}
          text={text}
          attachments={attachments}
          onChangeText={(value) => {
            props.onChangeText(value);
            setText(value);
          }}
          onChangeAttachments={(nextAttachments) => {
            props.onChangeAttachments(nextAttachments);
            setAttachments(nextAttachments);
          }}
        />
      );
    };

    return {
      ...render(<ControlledChatInput />),
      props,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockVoiceRecorderOverlay.mockReset();
    mockUseChatVoiceRecorder.mockImplementation(() => createVoiceRecorderState());
  });

  it('should render the text input', () => {
    const { getByPlaceholderText } = render(<ChatInput {...createProps()} />);
    expect(getByPlaceholderText('Message...')).toBeTruthy();
  });

  it('should not call onSend when text is empty', () => {
    const { getByPlaceholderText, props } = renderControlledChatInput();
    // Send button exists but is disabled when text is empty
    const input = getByPlaceholderText('Message...');
    expect(input).toBeTruthy();
    // Pressing send with no text shouldn't trigger callback
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it('should call onSend with text when send is pressed', () => {
    const onSend = jest.fn();
    const { getByPlaceholderText, getByTestId } = renderControlledChatInput({ onSend });
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Hello world');
    // Find the send button by its icon testID
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);
    expect(onSend).toHaveBeenCalledWith('Hello world', undefined);
  });

  it('should leave text control to the parent after sending', () => {
    const onSend = jest.fn();
    const { getByPlaceholderText, getByTestId } = renderControlledChatInput({ onSend });
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);
    expect(input.props.value).toBe('test');
  });

  it('should show stop button when loading', () => {
    const { getByTestId } = render(<ChatInput {...createProps({ isLoading: true })} />);
    const stopIcon = getByTestId('icon-Square');
    expect(stopIcon).toBeTruthy();
  });

  it('should call onStop when stop button is pressed', () => {
    const onStop = jest.fn();
    const { getByTestId } = render(<ChatInput {...createProps({ isLoading: true, onStop })} />);
    const stopIcon = getByTestId('icon-Square');
    fireEvent.press(stopIcon.parent || stopIcon);
    expect(onStop).toHaveBeenCalled();
  });

  it('should populate the input with the controlled text while editing', () => {
    const { getByPlaceholderText } = render(
      <ChatInput {...createProps({ text: 'Edit this', isEditing: true })} />,
    );
    const input = getByPlaceholderText('Message...');
    expect(input.props.value).toBe('Edit this');
  });

  it('should preserve the controlled draft when editing mode ends', () => {
    const screen = render(<ChatInput {...createProps({ text: 'Edit this', isEditing: true })} />);

    expect(screen.getByPlaceholderText('Message...').props.value).toBe('Edit this');

    screen.rerender(<ChatInput {...createProps({ text: 'Edit this', isEditing: false })} />);

    expect(screen.getByPlaceholderText('Message...').props.value).toBe('Edit this');
  });

  it('should pick image when attachment button is pressed and supportsVision', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_, __, buttons) => {
      buttons?.[0]?.onPress?.();
    });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [
        { uri: 'file://photo.jpg', fileName: 'photo.jpg', mimeType: 'image/jpeg', fileSize: 1000 },
      ],
    });

    const onSend = jest.fn();
    const { getByTestId } = renderControlledChatInput({ onSend, supportsVision: true });

    const paperclipIcon = getByTestId('icon-Paperclip');
    fireEvent.press(paperclipIcon.parent || paperclipIcon);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
        mediaTypes: ['images'],
        quality: 0.8,
      });
    });

    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    expect(onSend).toHaveBeenCalledTimes(1);
    const [sentText, sentAttachments] = onSend.mock.calls[0];
    expect(sentText).toBe('');
    expect(sentAttachments).toEqual([
      expect.objectContaining({
        type: 'image',
        uri: 'file://photo.jpg',
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 1000,
      }),
    ]);
    expect(sentAttachments[0]).not.toHaveProperty('base64');

    alertSpy.mockRestore();
  });

  it('should allow picking a document when attachment button is pressed with vision support', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_, __, buttons) => {
      buttons?.[1]?.onPress?.();
    });
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf', size: 2000 }],
    });

    const { getByTestId } = renderControlledChatInput({ supportsVision: true });

    const paperclipIcon = getByTestId('icon-Paperclip');
    fireEvent.press(paperclipIcon.parent || paperclipIcon);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
      expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
        type: '*/*',
        copyToCacheDirectory: true,
      });
    });

    alertSpy.mockRestore();
  });

  it('should pick document when attachment button is pressed without vision', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf', size: 2000 }],
    });

    const { getByTestId } = renderControlledChatInput({ supportsVision: false });

    const paperclipIcon = getByTestId('icon-Paperclip');
    fireEvent.press(paperclipIcon.parent || paperclipIcon);

    await waitFor(() => {
      expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
        type: '*/*',
        copyToCacheDirectory: true,
      });
    });
  });

  it('should send a voice note through the normal onSend path', async () => {
    const voiceAttachment: Attachment = {
      id: 'voice-1',
      type: 'audio',
      uri: 'file:///voice-note.m4a',
      name: 'voice-note.m4a',
      mimeType: 'audio/mp4',
      size: 4096,
      durationMs: 4200,
      transcript: 'Spoken request',
      waveformLevels: [0.2, 0.5, 0.35],
    };

    mockUseChatVoiceRecorder.mockImplementation((options: VoiceRecorderOptions) =>
      createVoiceRecorderState({
        pressableHandlers: {
          onPressIn: jest.fn(),
          onPressOut: jest.fn(() =>
            options.onVoiceNoteReady({
              transcript: 'Spoken request',
              attachment: voiceAttachment,
            }),
          ),
          onTouchMove: jest.fn(),
          onTouchCancel: jest.fn(),
        },
      }),
    );

    const onSend = jest.fn();
    const { getByTestId } = renderControlledChatInput({ onSend });

    fireEvent(getByTestId('chat-voice-button'), 'pressIn', { nativeEvent: { pageY: 240 } });
    fireEvent(getByTestId('chat-voice-button'), 'pressOut', { nativeEvent: { pageY: 240 } });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('Spoken request', [voiceAttachment]);
    });
  });

  it('should not wait for an async voice-note send to settle before completing the recorder handoff', async () => {
    const voiceAttachment: Attachment = {
      id: 'voice-1',
      type: 'audio',
      uri: 'file:///voice-note.m4a',
      name: 'voice-note.m4a',
      mimeType: 'audio/mp4',
      size: 4096,
      durationMs: 4200,
      transcript: 'Ship the voice transcript only',
      waveformLevels: [0.2, 0.5, 0.35],
    };

    let readyResult: Promise<void> | void;
    let resolveSend: (() => void) | undefined;

    mockUseChatVoiceRecorder.mockImplementation((options: VoiceRecorderOptions) =>
      createVoiceRecorderState({
        pressableHandlers: {
          onPressIn: jest.fn(),
          onPressOut: jest.fn(() => {
            readyResult = options.onVoiceNoteReady({
              transcript: 'Ship the voice transcript only',
              attachment: voiceAttachment,
            });
          }),
          onTouchMove: jest.fn(),
          onTouchCancel: jest.fn(),
        },
      }),
    );

    const onSend = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const { getByTestId } = renderControlledChatInput({ onSend });

    fireEvent(getByTestId('chat-voice-button'), 'pressIn', { nativeEvent: { pageY: 240 } });
    fireEvent(getByTestId('chat-voice-button'), 'pressOut', { nativeEvent: { pageY: 240 } });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('Ship the voice transcript only', [voiceAttachment]);
    });

    expect(readyResult).toBeUndefined();
    expect(resolveSend).toBeDefined();

    await act(async () => {
      resolveSend?.();
      await Promise.resolve();
    });
  });

  it('should show the in-chat voice overlay and disable text editing while recording', () => {
    mockUseChatVoiceRecorder.mockImplementation(() =>
      createVoiceRecorderState({
        phase: 'recording',
        isActive: true,
        isRecording: true,
        elapsedMs: 2600,
        errorMessage: 'Microphone is busy',
      }),
    );

    const { getByPlaceholderText, getByTestId, getByText } = render(
      <ChatInput {...createProps()} />,
    );

    expect(getByTestId('mock-voice-overlay')).toBeTruthy();
    expect(getByPlaceholderText('Message...').props.editable).toBe(false);
    expect(getByText('Microphone is busy')).toBeTruthy();
  });

  it('should render the in-chat voice overlay in an absolute non-interactive layer', () => {
    mockUseChatVoiceRecorder.mockImplementation(() =>
      createVoiceRecorderState({
        phase: 'recording',
        isActive: true,
        isRecording: true,
      }),
    );

    const { getByTestId } = render(<ChatInput {...createProps()} />);

    const overlayLayer = getByTestId('chat-voice-overlay-layer');
    expect(overlayLayer.props.pointerEvents).toBe('none');
    expect(overlayLayer.props.style).toMatchObject({
      position: 'absolute',
      left: 0,
      right: 0,
    });
  });

  it('should keep the voice button active while the user slides upward to cancel', () => {
    let tree: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ChatInput {...createProps()} />);
    });

    const voiceButton = tree!.root.findByProps({ testID: 'chat-voice-button' });

    expect(voiceButton.props.pressRetentionOffset).toMatchObject({
      top: 80,
      right: 32,
      bottom: 32,
      left: 32,
    });
  });
});
