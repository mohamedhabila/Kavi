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
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
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
const mockPause = jest.fn();
const mockResume = jest.fn();
const mockStopAndProcess = jest.fn();
const mockOnStateChange = jest.fn();
const mockOnTranscript = jest.fn();
const mockOnResponse = jest.fn();
let mockManagerState = 'idle';

jest.mock('../../src/services/voice/talkMode', () => ({
  TalkModeManager: jest.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    pause: mockPause,
    resume: mockResume,
    stopAndProcess: mockStopAndProcess,
    getState: jest.fn(() => mockManagerState),
    onStateChange: mockOnStateChange,
    onTranscript: mockOnTranscript,
    onResponse: mockOnResponse,
  })),
}));

const mockResolveSpeechBackend = jest.fn();
jest.mock('../../src/services/voice/voiceBackend', () => ({
  resolveSpeechBackend: (...args: unknown[]) => mockResolveSpeechBackend(...args),
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

function getLatestAgentHandler(): (input: string) => Promise<string> {
  return getLatestManagerCall()[0];
}

function emitManagerError(error: Error): void {
  const handlers = getLatestManagerCall()[1];
  handlers.onError(error);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockManagerState = 'idle';
  mockStart.mockImplementation(async () => {
    mockManagerState = 'listening';
  });
  mockStop.mockResolvedValue(undefined);
  mockPause.mockResolvedValue(undefined);
  mockResume.mockResolvedValue(undefined);
  mockStopAndProcess.mockResolvedValue(undefined);
  mockOnStateChange.mockReturnValue(jest.fn());
  mockOnTranscript.mockReturnValue(jest.fn());
  mockOnResponse.mockReturnValue(jest.fn());
  mockResolveSpeechBackend.mockResolvedValue({
    apiKey: 'not-rendered',
    baseUrl: 'https://speech.example.test',
    providerName: 'Speech',
  });
  mockSendVoiceConversationTurn.mockResolvedValue('A concise reply');
  mockEmitVoiceEvent.mockResolvedValue(undefined);
  mockHandleBack.mockReset();
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('VoiceScreen', () => {
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

  it('uses safe system speech and the canonical chat handler for assistant turns', async () => {
    render(<VoiceScreen />);

    const config = getLatestManagerCall()[2];
    expect(config.ttsProvider).toBe('system');

    await expect(getLatestAgentHandler()('Plan my afternoon')).resolves.toBe('A concise reply');
    expect(mockSendVoiceConversationTurn).toHaveBeenCalledWith('Plan my afternoon', {
      additionalSystemPrompt: 'Keep responses concise and conversational.',
    });
  });

  it('checks speech readiness before starting and emits a truthful start event', async () => {
    const { getByTestId } = render(<VoiceScreen />);

    fireEvent.press(getByTestId('voice-primary-button'));

    await waitFor(() => expect(mockResolveSpeechBackend).toHaveBeenCalledTimes(1));
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockEmitVoiceEvent).toHaveBeenCalledWith('started');
  });

  it('cancels a pending readiness check when the voice screen closes', async () => {
    let resolveBackend!: (value: { apiKey: string; baseUrl: string; providerName: string }) => void;
    mockResolveSpeechBackend.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBackend = resolve;
        }),
    );
    const { getByTestId, unmount } = render(<VoiceScreen />);

    fireEvent.press(getByTestId('voice-primary-button'));
    await waitFor(() => expect(mockResolveSpeechBackend).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      resolveBackend({
        apiKey: 'not-rendered',
        baseUrl: 'https://speech.example.test',
        providerName: 'Speech',
      });
      await Promise.resolve();
    });

    expect(mockStart).not.toHaveBeenCalled();
  });

  it('offers setup and text fallback when transcription is not configured', async () => {
    mockResolveSpeechBackend.mockResolvedValueOnce(null);
    const { getByTestId, getByText } = render(<VoiceScreen />);

    fireEvent.press(getByTestId('voice-primary-button'));

    await waitFor(() => {
      expect(
        getByText(
          'Voice transcription is not set up yet. Connect a supported speech service in Settings or continue with text.',
        ),
      ).toBeTruthy();
    });
    expect(mockStart).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('voice-recovery-settings'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('Settings', {
        returnTo: { name: 'Voice' },
      }),
    );
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
        'Microphone access is off. Enable it in your device settings, then try again.',
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

    await expect(getLatestAgentHandler()('hello')).rejects.toMatchObject({
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

    expect(mockStopAndProcess).toHaveBeenCalledTimes(1);
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('provides explicit end, stop-reply, and resume controls for session states', async () => {
    let stateCallback: (state: string) => void = () => {};
    mockOnStateChange.mockImplementation((callback) => {
      stateCallback = callback;
      return jest.fn();
    });
    const { getByTestId } = render(<VoiceScreen />);

    act(() => stateCallback('speaking'));
    fireEvent.press(getByTestId('voice-primary-button'));
    expect(mockPause).toHaveBeenCalledTimes(1);

    act(() => stateCallback('paused'));
    fireEvent.press(getByTestId('voice-primary-button'));
    expect(mockResume).toHaveBeenCalledTimes(1);

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
