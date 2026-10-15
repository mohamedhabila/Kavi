import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { VoiceScreen } from '../../src/screens/VoiceScreen';
import { VoiceOperationError } from '../../src/services/voice/voiceErrors';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const ReactModule = require('react');
    const { View } = require('react-native');
    return ReactModule.createElement(View, props, children);
  },
}));

const mockNavigate = jest.fn();
const mockHandleBack = jest.fn();
let mockRouteParams: Record<string, unknown> | undefined;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: mockRouteParams }),
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactModule = require('react');
    ReactModule.useEffect(callback, [callback]);
  },
}));

jest.mock('../../src/navigation/useBackToChat', () => ({
  useBackToChat: () => mockHandleBack,
}));

jest.mock('../../src/components/approval/ApprovalBanner', () => ({
  ApprovalBanner: () => null,
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
      header: '#111',
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
      warning: '#ff0',
      success: '#0f0',
      info: '#00f',
      inputBackground: '#222',
      inputBorder: '#333',
    },
  }),
  AppPalette: {},
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      activeConversationId: 'conversation-1',
      conversations: [{ id: 'conversation-1', title: 'Trip planning' }],
    }),
}));

const mockStart = jest.fn();
const mockStop = jest.fn();
const mockFinishSpeaking = jest.fn();
const mockStopReply = jest.fn();
const mockOnStateChange = jest.fn();
const mockOnPartialTranscript = jest.fn();
const mockOnTranscript = jest.fn();
const mockOnResponse = jest.fn();
let mockManagerState = 'idle';

jest.mock('../../src/services/voice/talkMode', () => ({
  createTalkModeDependencies: jest.fn((ttsProvider: string) => ({ ttsProvider })),
  TalkModeManager: jest.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    finishSpeaking: mockFinishSpeaking,
    stopReply: mockStopReply,
    getState: jest.fn(() => mockManagerState),
    onStateChange: mockOnStateChange,
    onPartialTranscript: mockOnPartialTranscript,
    onTranscript: mockOnTranscript,
    onResponse: mockOnResponse,
  })),
}));

const mockIsSpeechRecognitionAvailable = jest.fn();
const mockRequestSpeechRecognitionPermission = jest.fn();
jest.mock('../../src/services/voice/speechRecognition', () => ({
  isSpeechRecognitionAvailable: () => mockIsSpeechRecognitionAvailable(),
  requestSpeechRecognitionPermission: () => mockRequestSpeechRecognitionPermission(),
}));

const mockSendVoiceConversationTurn = jest.fn();
jest.mock('../../src/services/voice/voiceConversationBridge', () => {
  class MockVoiceConversationBridgeError extends Error {
    kind: 'unavailable' | 'no_response';

    constructor(kind: 'unavailable' | 'no_response') {
      super(kind);
      this.kind = kind;
    }
  }

  return {
    sendVoiceConversationTurn: (...args: unknown[]) => mockSendVoiceConversationTurn(...args),
    VoiceConversationBridgeError: MockVoiceConversationBridgeError,
  };
});

const mockEmitVoiceEvent = jest.fn();
jest.mock('../../src/services/events/bus', () => ({
  emitVoiceEvent: (...args: unknown[]) => mockEmitVoiceEvent(...args),
}));

function getLatestManagerCall(): any[] {
  const { TalkModeManager } = jest.requireMock('../../src/services/voice/talkMode');
  return TalkModeManager.mock.calls[TalkModeManager.mock.calls.length - 1];
}

function getLatestAgentHandler(): (
  input: string,
  turn: { onReplyText: (text: string) => void },
) => Promise<unknown> {
  return getLatestManagerCall()[0];
}

const silentTurn = { onReplyText: jest.fn() };

function captureListener(mock: jest.Mock): (value: string) => void {
  let listener: (value: string) => void = () => {};
  mock.mockImplementation((callback) => {
    listener = callback;
    return jest.fn();
  });
  return (value) => listener(value);
}

function emitManagerError(error: Error): void {
  const handlers = getLatestManagerCall()[1];
  handlers.onError(error);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = undefined;
  mockManagerState = 'idle';
  mockStart.mockImplementation(async () => {
    mockManagerState = 'listening';
  });
  mockStop.mockResolvedValue(undefined);
  mockOnStateChange.mockReturnValue(jest.fn());
  mockOnPartialTranscript.mockReturnValue(jest.fn());
  mockOnTranscript.mockReturnValue(jest.fn());
  mockOnResponse.mockReturnValue(jest.fn());
  mockIsSpeechRecognitionAvailable.mockReturnValue(true);
  mockRequestSpeechRecognitionPermission.mockResolvedValue(true);
  mockSendVoiceConversationTurn.mockResolvedValue({
    response: 'A concise reply',
    spokenText: 'A concise reply',
  });
  mockEmitVoiceEvent.mockResolvedValue(undefined);
  mockHandleBack.mockReset();
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('VoiceScreen', () => {
  // Opened as the phone's assistant (long-press home or power), voice used to wait for a tap.
  it('starts listening at once when opened as the phone assistant, once per request', async () => {
    mockRouteParams = { autoStartRequestId: 1 };
    const view = render(<VoiceScreen />);

    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    view.rerender(<VoiceScreen />);
    await act(async () => undefined);
    expect(mockStart).toHaveBeenCalledTimes(1);

    mockRouteParams = { autoStartRequestId: 2 };
    mockManagerState = 'idle';
    view.rerender(<VoiceScreen />);
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(2));
  });

  it('waits for a tap when opened from the app', async () => {
    render(<VoiceScreen />);
    await act(async () => undefined);

    expect(mockStart).not.toHaveBeenCalled();
  });

  it('presents an assistant-first title, privacy contract, and active chat destination', () => {
    const { getByText } = render(<VoiceScreen />);

    expect(getByText('Voice conversation')).toBeTruthy();
    expect(getByText('Ready for a voice turn')).toBeTruthy();
    expect(getByText('Your voice, under your control')).toBeTruthy();
    expect(getByText('Transcripts and replies are saved in Trip planning.')).toBeTruthy();
    expect(
      getByText('Your spoken turns appear here and are also saved in your current chat.'),
    ).toBeTruthy();
  });

  it('speaks with system speech and runs turns through the chat, streaming the reply', async () => {
    const { createTalkModeDependencies } = jest.requireMock('../../src/services/voice/talkMode');
    render(<VoiceScreen />);

    expect(createTalkModeDependencies).toHaveBeenCalledWith('system');
    expect(getLatestManagerCall()[2]).toEqual({ ttsProvider: 'system' });

    await expect(getLatestAgentHandler()('Plan my afternoon', silentTurn)).resolves.toEqual({
      response: 'A concise reply',
      spokenText: 'A concise reply',
    });
    expect(mockSendVoiceConversationTurn).toHaveBeenCalledWith('Plan my afternoon', {
      additionalSystemPrompt:
        'Your reply is spoken aloud. Answer in short, natural sentences, without markdown, lists, links, code or emoji.',
      onReplyText: silentTurn.onReplyText,
    });
  });

  it('asks for speech recognition before starting and emits a truthful start event', async () => {
    const { getByTestId } = render(<VoiceScreen />);

    fireEvent.press(getByTestId('voice-primary-button'));

    await waitFor(() => expect(mockRequestSpeechRecognitionPermission).toHaveBeenCalledTimes(1));
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockEmitVoiceEvent).toHaveBeenCalledWith('started');
  });

  it('cancels a pending permission request when the voice screen closes', async () => {
    let grant!: (granted: boolean) => void;
    mockRequestSpeechRecognitionPermission.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const { getByTestId, unmount } = render(<VoiceScreen />);

    fireEvent.press(getByTestId('voice-primary-button'));
    await waitFor(() => expect(mockRequestSpeechRecognitionPermission).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      grant(true);
      await Promise.resolve();
    });

    expect(mockStart).not.toHaveBeenCalled();
  });

  it('explains when this phone has no speech recognition and offers text instead', async () => {
    mockIsSpeechRecognitionAvailable.mockReturnValue(false);
    const { getByTestId, getByText, queryByTestId } = render(<VoiceScreen />);

    fireEvent.press(getByTestId('voice-primary-button'));

    await waitFor(() => {
      expect(
        getByText(
          "Speech recognition isn't available on this phone for your language. Continue with text, or check your phone's speech settings.",
        ),
      ).toBeTruthy();
    });
    expect(mockRequestSpeechRecognitionPermission).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
    expect(queryByTestId('voice-recovery-settings')).toBeNull();
    expect(getByTestId('voice-continue-with-text')).toBeTruthy();
  });

  it('sends the person to device settings when speech recognition is not allowed', async () => {
    mockRequestSpeechRecognitionPermission.mockResolvedValueOnce(false);
    const { getByTestId, getByText } = render(<VoiceScreen />);

    fireEvent.press(getByTestId('voice-primary-button'));

    await waitFor(() =>
      expect(
        getByText(
          'Microphone or speech recognition access is off. Enable both in your device settings, then try again.',
        ),
      ).toBeTruthy(),
    );
    expect(mockStart).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('voice-recovery-settings'));
    await waitFor(() => expect(Linking.openSettings).toHaveBeenCalledTimes(1));
  });

  it('maps microphone denial to safe copy and opens device settings without raw errors', async () => {
    let stateCallback: (state: string) => void = () => {};
    mockOnStateChange.mockImplementation((callback) => {
      stateCallback = callback;
      return jest.fn();
    });
    const { getByTestId, getByText, queryByText } = render(<VoiceScreen />);
    const rawError = new VoiceOperationError(
      'permission_denied',
      'secret native recorder code 0xBAD',
    );

    act(() => {
      emitManagerError(rawError);
      stateCallback('error');
    });

    expect(
      getByText(
        'Microphone or speech recognition access is off. Enable both in your device settings, then try again.',
      ),
    ).toBeTruthy();
    expect(queryByText('secret native recorder code 0xBAD')).toBeNull();

    fireEvent.press(getByTestId('voice-recovery-settings'));
    await waitFor(() => expect(Linking.openSettings).toHaveBeenCalledTimes(1));
  });

  it('turns a bridge failure into a typed voice error without returning raw text for speech', async () => {
    const { VoiceConversationBridgeError } = jest.requireMock(
      '../../src/services/voice/voiceConversationBridge',
    );
    mockSendVoiceConversationTurn.mockRejectedValueOnce(
      new VoiceConversationBridgeError('unavailable'),
    );
    render(<VoiceScreen />);

    await expect(getLatestAgentHandler()('hello', silentTurn)).rejects.toMatchObject({
      name: 'VoiceOperationError',
      kind: 'unexpected',
      message: 'Voice assistant turn failed',
    });
  });

  it('finishes the current utterance instead of discarding it when the mic is tapped', () => {
    let stateCallback: (state: string) => void = () => {};
    mockOnStateChange.mockImplementation((callback) => {
      stateCallback = callback;
      return jest.fn();
    });
    const { getByTestId, getByText } = render(<VoiceScreen />);

    act(() => stateCallback('listening'));
    expect(getByText('Tap the microphone when you are finished speaking.')).toBeTruthy();
    fireEvent.press(getByTestId('voice-primary-button'));

    expect(mockFinishSpeaking).toHaveBeenCalledTimes(1);
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('provides explicit end and stop-reply controls for session states', async () => {
    let stateCallback: (state: string) => void = () => {};
    mockOnStateChange.mockImplementation((callback) => {
      stateCallback = callback;
      return jest.fn();
    });
    const { getByTestId, getByLabelText } = render(<VoiceScreen />);

    act(() => stateCallback('speaking'));
    expect(getByLabelText('Stop reply')).toBeTruthy();
    fireEvent.press(getByTestId('voice-primary-button'));
    expect(mockStopReply).toHaveBeenCalledTimes(1);

    act(() => stateCallback('processing'));
    fireEvent.press(getByTestId('voice-primary-button'));
    expect(mockStopReply).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId('voice-end-session'));
    await waitFor(() => expect(mockStop).toHaveBeenCalled());
    expect(mockEmitVoiceEvent).toHaveBeenCalledWith('stopped');
  });

  it('keeps multiple transcript and response turns grouped in session order', () => {
    let transcriptCallback: (text: string) => void = () => {};
    let responseCallback: (text: string) => void = () => {};
    mockOnTranscript.mockImplementation((callback) => {
      transcriptCallback = callback;
      return jest.fn();
    });
    mockOnResponse.mockImplementation((callback) => {
      responseCallback = callback;
      return jest.fn();
    });
    const { getByText } = render(<VoiceScreen />);

    act(() => {
      transcriptCallback('First question');
      responseCallback('First answer');
      transcriptCallback('Second question');
      responseCallback('Second answer');
    });

    expect(getByText('First question')).toBeTruthy();
    expect(getByText('First answer')).toBeTruthy();
    expect(getByText('Second question')).toBeTruthy();
    expect(getByText('Second answer')).toBeTruthy();
    expect(mockEmitVoiceEvent).toHaveBeenCalledWith('transcript', {
      transcript: 'Second question',
    });
  });

  it('shows the words heard while the person speaks, until the turn is taken', () => {
    const emitPartial = captureListener(mockOnPartialTranscript);
    const emitTranscript = captureListener(mockOnTranscript);
    const { getByTestId, queryByTestId, getByText } = render(<VoiceScreen />);

    act(() => emitPartial('Remind me to'));
    expect(getByTestId('voice-partial-transcript')).toBeTruthy();
    expect(getByText('Remind me to')).toBeTruthy();

    act(() => emitTranscript('Remind me to call Ana'));
    expect(queryByTestId('voice-partial-transcript')).toBeNull();
    expect(getByText('Remind me to call Ana')).toBeTruthy();
  });

  it('clears the words heard when listening stops without a turn', () => {
    const emitPartial = captureListener(mockOnPartialTranscript);
    const emitState = captureListener(mockOnStateChange);
    const { queryByTestId } = render(<VoiceScreen />);

    act(() => {
      emitState('listening');
      emitPartial('Never mind');
    });
    expect(queryByTestId('voice-partial-transcript')).toBeTruthy();
    act(() => emitState('idle'));

    expect(queryByTestId('voice-partial-transcript')).toBeNull();
  });

  it('stops voice and returns to Chat for text fallback', async () => {
    const { getByTestId } = render(<VoiceScreen />);

    fireEvent.press(getByTestId('voice-continue-with-text'));

    await waitFor(() => expect(mockStop).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith('Chat');
  });

  it('uses the shared back contract and stops the manager on unmount', () => {
    const { getByTestId, unmount } = render(<VoiceScreen />);

    fireEvent.press(getByTestId('voice-back-button'));
    expect(mockHandleBack).toHaveBeenCalledTimes(1);

    unmount();
    expect(mockStop).toHaveBeenCalled();
  });
});
