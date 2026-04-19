// ---------------------------------------------------------------------------
// Tests — VoiceScreen
// ---------------------------------------------------------------------------

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { VoiceScreen } from '../../src/screens/VoiceScreen';

// Mock safe area
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

// Mock navigation
const mockGoBack = jest.fn();
const mockHandleBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

jest.mock('../../src/navigation/useBackToChat', () => ({
  useBackToChat: () => mockHandleBack,
}));

// Mock theme
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

// Mock TalkModeManager
const mockStart = jest.fn();
const mockStop = jest.fn();
const mockOnStateChange = jest.fn();
const mockOnTranscript = jest.fn();
const mockOnResponse = jest.fn();
const mockEmitVoiceEvent = jest.fn();
const mockRunOrchestrator = jest.fn();
const mockGetSettingsState = jest.fn();
const mockGetProviderApiKey = jest.fn();
const mockGenerateId = jest.fn();

jest.mock('../../src/services/voice/talkMode', () => ({
  TalkModeManager: jest.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    pause: jest.fn(),
    resume: jest.fn(),
    getState: jest.fn().mockReturnValue('idle'),
    onStateChange: mockOnStateChange,
    onTranscript: mockOnTranscript,
    onResponse: mockOnResponse,
  })),
}));

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: (...args: any[]) => mockRunOrchestrator(...args),
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: (...args: any[]) => mockGetSettingsState(...args),
  },
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: (...args: any[]) => mockGetProviderApiKey(...args),
}));

jest.mock('../../src/utils/id', () => ({
  generateId: (...args: any[]) => mockGenerateId(...args),
}));

// Mock event bus
jest.mock('../../src/services/events/bus', () => ({
  emitVoiceEvent: (...args: any[]) => mockEmitVoiceEvent(...args),
}));

const buildSettingsState = (overrides: Record<string, unknown> = {}) => ({
  providers: [
    {
      id: 'provider-1',
      enabled: true,
      model: 'provider-model',
      apiKey: undefined,
    },
  ],
  activeProviderId: 'provider-1',
  activeModel: undefined,
  systemPrompt: '',
  linkUnderstandingEnabled: true,
  mediaUnderstandingEnabled: false,
  maxLinks: 5,
  ...overrides,
});

const getLatestAgentHandler = (): ((input: string) => Promise<string>) => {
  const { TalkModeManager } = jest.requireMock('../../src/services/voice/talkMode');
  const calls = TalkModeManager.mock.calls;
  return calls[calls.length - 1][0];
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStart.mockReset();
  mockStop.mockReset();
  mockOnStateChange.mockReset().mockReturnValue(jest.fn());
  mockOnTranscript.mockReset().mockReturnValue(jest.fn());
  mockOnResponse.mockReset().mockReturnValue(jest.fn());
  mockEmitVoiceEvent.mockReset().mockResolvedValue(undefined);
  mockRunOrchestrator.mockReset().mockResolvedValue(undefined);
  mockGetSettingsState.mockReset().mockReturnValue(buildSettingsState());
  mockGetProviderApiKey.mockReset().mockResolvedValue('secure-key');
  mockGenerateId.mockReset().mockReturnValue('voice-id');
  mockHandleBack.mockReset();
});

describe('VoiceScreen', () => {
  it('renders header with title', () => {
    const { getByText } = render(<VoiceScreen />);
    expect(getByText('Talk Mode')).toBeTruthy();
  });

  it('shows idle state initially', () => {
    const { getByText } = render(<VoiceScreen />);
    expect(getByText('Tap the microphone to start')).toBeTruthy();
  });

  it('shows transcript placeholder', () => {
    const { getByText } = render(<VoiceScreen />);
    expect(getByText('Your conversation will appear here')).toBeTruthy();
  });

  it('shows response placeholder', () => {
    const { getByText } = render(<VoiceScreen />);
    // In the new design, both transcript and response boxes share a single placeholder
    expect(getByText('Your conversation will appear here')).toBeTruthy();
  });

  it('shows hint text', () => {
    const { getByText } = render(<VoiceScreen />);
    expect(getByText('Tap to start voice conversation')).toBeTruthy();
  });

  it('navigates back on back button press', () => {
    const { UNSAFE_getAllByType } = render(<VoiceScreen />);
    const touchables = UNSAFE_getAllByType(require('react-native').TouchableOpacity);
    fireEvent.press(touchables[0]); // Back button
    expect(mockHandleBack).toHaveBeenCalled();
  });

  it('starts talk mode on mic button press', () => {
    const { UNSAFE_getAllByType } = render(<VoiceScreen />);
    const touchables = UNSAFE_getAllByType(require('react-native').TouchableOpacity);
    const micButton = touchables[touchables.length - 1];
    fireEvent.press(micButton);
    expect(mockStart).toHaveBeenCalled();
    expect(mockEmitVoiceEvent).toHaveBeenCalledWith('started');
  });

  it('registers state/transcript/response listeners on mount', () => {
    render(<VoiceScreen />);
    expect(mockOnStateChange).toHaveBeenCalled();
    expect(mockOnTranscript).toHaveBeenCalled();
    expect(mockOnResponse).toHaveBeenCalled();
  });

  it('renders listening state icon when state changes', () => {
    let stateCallback: (s: string) => void = () => {};
    mockOnStateChange.mockImplementation((cb: any) => {
      stateCallback = cb;
      return jest.fn();
    });
    const { getByText } = render(<VoiceScreen />);
    act(() => stateCallback('listening'));
    expect(getByText('Listening…')).toBeTruthy();
  });

  it('renders transcribing state label', () => {
    let stateCallback: (s: string) => void = () => {};
    mockOnStateChange.mockImplementation((cb: any) => {
      stateCallback = cb;
      return jest.fn();
    });
    const { getByText } = render(<VoiceScreen />);
    act(() => stateCallback('transcribing'));
    expect(getByText('Transcribing…')).toBeTruthy();
  });

  it('renders processing state label', () => {
    let stateCallback: (s: string) => void = () => {};
    mockOnStateChange.mockImplementation((cb: any) => {
      stateCallback = cb;
      return jest.fn();
    });
    const { getByText } = render(<VoiceScreen />);
    act(() => stateCallback('processing'));
    expect(getByText('Thinking…')).toBeTruthy();
  });

  it('renders speaking state label', () => {
    let stateCallback: (s: string) => void = () => {};
    mockOnStateChange.mockImplementation((cb: any) => {
      stateCallback = cb;
      return jest.fn();
    });
    const { getByText } = render(<VoiceScreen />);
    act(() => stateCallback('speaking'));
    expect(getByText('Speaking…')).toBeTruthy();
  });

  it('renders error state and emits an error event', () => {
    let stateCallback: (s: string) => void = () => {};
    mockOnStateChange.mockImplementation((cb: any) => {
      stateCallback = cb;
      return jest.fn();
    });

    const { getByText } = render(<VoiceScreen />);
    act(() => stateCallback('error'));

    expect(getByText('Error — tap to retry')).toBeTruthy();
    expect(mockEmitVoiceEvent).toHaveBeenCalledWith('error');
  });

  it('shows Tap to stop when active', () => {
    let stateCallback: (s: string) => void = () => {};
    mockOnStateChange.mockImplementation((cb: any) => {
      stateCallback = cb;
      return jest.fn();
    });
    const { getByText } = render(<VoiceScreen />);
    act(() => stateCallback('listening'));
    expect(getByText('Tap to stop')).toBeTruthy();
  });

  it('calls stop when pressing mic while active', () => {
    let stateCallback: (s: string) => void = () => {};
    mockOnStateChange.mockImplementation((cb: any) => {
      stateCallback = cb;
      return jest.fn();
    });
    const { UNSAFE_getAllByType } = render(<VoiceScreen />);
    act(() => stateCallback('listening'));
    const touchables = UNSAFE_getAllByType(require('react-native').TouchableOpacity);
    const micButton = touchables[touchables.length - 1];
    fireEvent.press(micButton);
    expect(mockStop).toHaveBeenCalled();
    expect(mockEmitVoiceEvent).toHaveBeenCalledWith('stopped');
  });

  it('displays transcript when set', () => {
    let transcriptCb: (t: string) => void = () => {};
    mockOnTranscript.mockImplementation((cb: any) => {
      transcriptCb = cb;
      return jest.fn();
    });
    const { getByText } = render(<VoiceScreen />);
    act(() => transcriptCb('Hello world'));
    expect(getByText('Hello world')).toBeTruthy();
    expect(mockEmitVoiceEvent).toHaveBeenCalledWith('transcript', { transcript: 'Hello world' });
  });

  it('displays response when set', () => {
    let responseCb: (r: string) => void = () => {};
    mockOnResponse.mockImplementation((cb: any) => {
      responseCb = cb;
      return jest.fn();
    });
    const { getByText } = render(<VoiceScreen />);
    act(() => responseCb('AI says hello'));
    expect(getByText('AI says hello')).toBeTruthy();
    expect(mockEmitVoiceEvent).toHaveBeenCalledWith('response');
  });

  it('stops the talk mode manager on unmount', () => {
    const { unmount } = render(<VoiceScreen />);
    unmount();
    expect(mockStop).toHaveBeenCalled();
  });

  it('returns a no-provider message when no provider is enabled', async () => {
    mockGetSettingsState.mockReturnValue(
      buildSettingsState({
        providers: [],
        activeProviderId: null,
      }),
    );

    render(<VoiceScreen />);

    await expect(getLatestAgentHandler()('hello')).resolves.toBe(
      'No provider configured. Go to Settings to add one.',
    );
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });

  it('returns a no-model message when the provider has no selected model', async () => {
    mockGetSettingsState.mockReturnValue(
      buildSettingsState({
        providers: [{ id: 'provider-1', enabled: true, model: undefined, apiKey: undefined }],
        activeModel: undefined,
      }),
    );

    render(<VoiceScreen />);

    await expect(getLatestAgentHandler()('hello')).resolves.toBe('No model selected.');
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });

  it('returns a no-api-key message when neither secure storage nor provider config has a key', async () => {
    mockGetSettingsState.mockReturnValue(
      buildSettingsState({
        providers: [
          { id: 'provider-1', enabled: true, model: 'provider-model', apiKey: undefined },
        ],
      }),
    );
    mockGetProviderApiKey.mockResolvedValueOnce(null);

    render(<VoiceScreen />);

    await expect(getLatestAgentHandler()('hello')).resolves.toBe(
      'No API key configured for this provider.',
    );
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });

  it('runs the orchestrator with the secure API key and custom voice prompt', async () => {
    mockGetSettingsState.mockReturnValue(
      buildSettingsState({
        activeModel: 'active-model',
        systemPrompt: 'Be precise',
        providers: [
          { id: 'provider-1', enabled: true, model: 'provider-model', apiKey: 'fallback-key' },
        ],
      }),
    );
    mockRunOrchestrator.mockImplementationOnce(async (_request: any, callbacks: any) => {
      callbacks.onToken('Hello');
      callbacks.onToken(' world');
    });

    render(<VoiceScreen />);

    await expect(getLatestAgentHandler()('How are you?')).resolves.toBe('Hello world');
    expect(mockRunOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ id: 'provider-1', apiKey: 'secure-key' }),
        model: 'active-model',
        conversationId: 'voice_voice-id',
        systemPrompt: 'Be precise\nKeep responses concise and conversational.',
        linkUnderstandingEnabled: true,
        mediaUnderstandingEnabled: false,
        maxLinks: 5,
        messages: [expect.objectContaining({ role: 'user', content: 'How are you?' })],
      }),
      expect.any(Object),
    );
  });

  it('falls back to the provider API key and default voice prompt', async () => {
    mockGetSettingsState.mockReturnValue(
      buildSettingsState({
        providers: [
          { id: 'provider-1', enabled: true, model: 'provider-model', apiKey: 'inline-key' },
        ],
        systemPrompt: '',
      }),
    );
    mockGetProviderApiKey.mockResolvedValueOnce(null);
    mockRunOrchestrator.mockImplementationOnce(async (_request: any, callbacks: any) => {
      callbacks.onAssistantMessage('Fallback answer');
    });

    render(<VoiceScreen />);

    await expect(getLatestAgentHandler()('hello')).resolves.toBe('Fallback answer');
    expect(mockRunOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ id: 'provider-1', apiKey: 'inline-key' }),
        systemPrompt:
          'You are a helpful voice assistant. Keep responses concise and conversational.',
      }),
      expect.any(Object),
    );
  });

  it('returns an orchestrator error when the run throws before producing output', async () => {
    mockRunOrchestrator.mockRejectedValueOnce(new Error('orchestrator boom'));

    render(<VoiceScreen />);

    await expect(getLatestAgentHandler()('hello')).resolves.toBe('Error: orchestrator boom');
  });

  it('returns an orchestrator callback error when no assistant output is produced', async () => {
    mockRunOrchestrator.mockImplementationOnce(async (_request: any, callbacks: any) => {
      callbacks.onError(new Error('callback boom'));
    });

    render(<VoiceScreen />);

    await expect(getLatestAgentHandler()('hello')).resolves.toBe('Error: callback boom');
  });
});
