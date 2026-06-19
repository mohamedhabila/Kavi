import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { Attachment } from '../../src/types/attachment';
import { useChatVoiceRecorder } from '../../src/components/chat/useChatVoiceRecorder';

const mockStartRecording = jest.fn();
const mockStopRecording = jest.fn();
const mockGetRecordingStatus = jest.fn();
const mockTranscribeAudio = jest.fn();
const mockWaitForRecordedAudioFile = jest.fn();
const mockEnsureRecordingPermission = jest.fn();
const mockPersistVoiceNoteAttachment = jest.fn();
const mockDeleteVoiceNoteFile = jest.fn();

jest.mock('../../src/services/voice/voice', () => ({
  ensureRecordingPermission: (...args: any[]) => mockEnsureRecordingPermission(...args),
  getRecordingStatus: (...args: any[]) => mockGetRecordingStatus(...args),
  startRecording: (...args: any[]) => mockStartRecording(...args),
  stopRecording: (...args: any[]) => mockStopRecording(...args),
  transcribeAudio: (...args: any[]) => mockTranscribeAudio(...args),
  waitForRecordedAudioFile: (...args: any[]) => mockWaitForRecordedAudioFile(...args),
}));

jest.mock('../../src/services/voice/voiceNote', () => ({
  compactVoiceWaveformLevels: jest.fn((samples: number[]) =>
    samples.length > 0 ? samples : [0.2, 0.4, 0.3],
  ),
  deleteVoiceNoteFile: (...args: any[]) => mockDeleteVoiceNoteFile(...args),
  normalizeVoiceMeteringLevel: jest.fn(() => 0.42),
  persistVoiceNoteAttachment: (...args: any[]) => mockPersistVoiceNoteAttachment(...args),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: {
    Warning: 'warning',
    Success: 'success',
    Error: 'error',
  },
}));

const messages = {
  noSpeechDetected: 'No speech detected',
  microphonePermissionDenied: 'Microphone permission denied',
  genericFailure: 'Generic failure',
};

const activeRecordingStatus = {
  canRecord: true,
  isRecording: true,
  durationMillis: 0,
  mediaServicesDidReset: false,
  metering: -18,
  url: 'file:///mock/cache/recording.m4a',
};

describe('useChatVoiceRecorder', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockEnsureRecordingPermission.mockResolvedValue({ granted: true, requested: false });
    mockStartRecording.mockResolvedValue(undefined);
    mockStopRecording.mockResolvedValue('file:///mock/cache/recording.m4a');
    mockGetRecordingStatus.mockReturnValue(activeRecordingStatus);
    mockWaitForRecordedAudioFile.mockResolvedValue({
      inspected: true,
      exists: true,
      sizeBytes: 4096,
    });
    mockTranscribeAudio.mockResolvedValue({ text: 'Spoken request' });
    mockPersistVoiceNoteAttachment.mockImplementation(
      (): Attachment => ({
        id: 'voice-1',
        type: 'audio',
        uri: 'file:///mock/documents/voice-note.m4a',
        name: 'voice-note.m4a',
        mimeType: 'audio/mp4',
        size: 4096,
        durationMs: 900,
        transcript: 'Spoken request',
        waveformLevels: [0.3, 0.5, 0.4],
      }),
    );
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('rejects recordings that are too short before transcription', async () => {
    mockGetRecordingStatus.mockReturnValue({
      ...activeRecordingStatus,
      durationMillis: 120,
    });
    mockWaitForRecordedAudioFile.mockResolvedValue({
      inspected: true,
      exists: true,
      sizeBytes: 128,
    });

    const onVoiceNoteReady = jest.fn();
    const { result } = renderHook(() => useChatVoiceRecorder({ messages, onVoiceNoteReady }));

    await act(async () => {
      result.current.pressableHandlers.onPressIn({ nativeEvent: { pageY: 240 } } as any);
      await Promise.resolve();
    });

    act(() => {
      jest.advanceTimersByTime(120);
    });

    await act(async () => {
      result.current.pressableHandlers.onPressOut({ nativeEvent: { pageY: 240 } } as any);
    });

    await waitFor(() => {
      expect(result.current.errorMessage).toBe(messages.noSpeechDetected);
    });

    expect(mockTranscribeAudio).not.toHaveBeenCalled();
    expect(onVoiceNoteReady).not.toHaveBeenCalled();
    expect(mockDeleteVoiceNoteFile).toHaveBeenCalledWith('file:///mock/cache/recording.m4a');
  });

  it('does not reject a smaller file when the recording duration is otherwise valid', async () => {
    mockGetRecordingStatus.mockReturnValue({
      ...activeRecordingStatus,
      durationMillis: 640,
    });
    mockWaitForRecordedAudioFile.mockResolvedValue({
      inspected: true,
      exists: true,
      sizeBytes: 128,
    });

    const onVoiceNoteReady = jest.fn();
    const { result } = renderHook(() => useChatVoiceRecorder({ messages, onVoiceNoteReady }));

    await act(async () => {
      result.current.pressableHandlers.onPressIn({ nativeEvent: { pageY: 240 } } as any);
      await Promise.resolve();
    });

    act(() => {
      jest.advanceTimersByTime(320);
    });

    await act(async () => {
      result.current.pressableHandlers.onPressOut({ nativeEvent: { pageY: 240 } } as any);
    });

    await waitFor(() => {
      expect(onVoiceNoteReady).toHaveBeenCalledWith({
        transcript: 'Spoken request',
        attachment: expect.objectContaining({
          id: 'voice-1',
          uri: 'file:///mock/documents/voice-note.m4a',
        }),
      });
    });

    expect(mockTranscribeAudio).toHaveBeenCalledWith('file:///mock/cache/recording.m4a');
    expect(result.current.errorMessage).toBeNull();
  });

  it('requires a fresh hold after microphone permission is granted from a prompt', async () => {
    mockEnsureRecordingPermission.mockResolvedValue({ granted: true, requested: true });

    const onVoiceNoteReady = jest.fn();
    const { result } = renderHook(() => useChatVoiceRecorder({ messages, onVoiceNoteReady }));

    await act(async () => {
      result.current.pressableHandlers.onPressIn({ nativeEvent: { pageY: 240 } } as any);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.phase).toBe('idle');
    });

    expect(mockStartRecording).not.toHaveBeenCalled();
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
    expect(onVoiceNoteReady).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toBeNull();
  });

  it('silently discards a capture when the finger is released before recorder startup finishes', async () => {
    let resolveStartRecording: (() => void) | null = null;
    mockStartRecording.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStartRecording = resolve;
        }),
    );
    mockWaitForRecordedAudioFile.mockResolvedValue({
      inspected: true,
      exists: true,
      sizeBytes: 128,
    });

    const onVoiceNoteReady = jest.fn();
    const { result } = renderHook(() => useChatVoiceRecorder({ messages, onVoiceNoteReady }));

    await act(async () => {
      result.current.pressableHandlers.onPressIn({ nativeEvent: { pageY: 240 } } as any);
      await Promise.resolve();
    });

    await act(async () => {
      result.current.pressableHandlers.onPressOut({ nativeEvent: { pageY: 240 } } as any);
    });

    await act(async () => {
      resolveStartRecording?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.phase).toBe('idle');
    });

    expect(result.current.errorMessage).toBeNull();
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
    expect(onVoiceNoteReady).not.toHaveBeenCalled();
    expect(mockDeleteVoiceNoteFile).toHaveBeenCalledWith('file:///mock/cache/recording.m4a');
  });

  it('uses wall-clock duration when recorder status never advances before release', async () => {
    mockGetRecordingStatus.mockReturnValue({
      ...activeRecordingStatus,
      durationMillis: 0,
    });

    const onVoiceNoteReady = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useChatVoiceRecorder({ messages, onVoiceNoteReady }));

    await act(async () => {
      result.current.pressableHandlers.onPressIn({ nativeEvent: { pageY: 240 } } as any);
      await Promise.resolve();
    });

    act(() => {
      jest.advanceTimersByTime(400);
    });

    await act(async () => {
      result.current.pressableHandlers.onPressOut({ nativeEvent: { pageY: 240 } } as any);
    });

    await waitFor(() => {
      expect(onVoiceNoteReady).toHaveBeenCalledWith({
        transcript: 'Spoken request',
        attachment: expect.objectContaining({
          id: 'voice-1',
          uri: 'file:///mock/documents/voice-note.m4a',
        }),
      });
    });

    expect(mockTranscribeAudio).toHaveBeenCalledWith('file:///mock/cache/recording.m4a');
    expect(result.current.errorMessage).toBeNull();
  });

  it('transcribes and emits a persisted voice note after a valid recording', async () => {
    mockGetRecordingStatus.mockReturnValue({
      ...activeRecordingStatus,
      durationMillis: 900,
    });

    const onVoiceNoteReady = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useChatVoiceRecorder({ messages, onVoiceNoteReady }));

    await act(async () => {
      result.current.pressableHandlers.onPressIn({ nativeEvent: { pageY: 240 } } as any);
      await Promise.resolve();
    });

    act(() => {
      jest.advanceTimersByTime(400);
    });

    await act(async () => {
      result.current.pressableHandlers.onPressOut({ nativeEvent: { pageY: 240 } } as any);
    });

    await waitFor(() => {
      expect(onVoiceNoteReady).toHaveBeenCalledWith({
        transcript: 'Spoken request',
        attachment: expect.objectContaining({
          id: 'voice-1',
          uri: 'file:///mock/documents/voice-note.m4a',
        }),
      });
    });

    expect(mockTranscribeAudio).toHaveBeenCalledWith('file:///mock/cache/recording.m4a');
    expect(mockPersistVoiceNoteAttachment).toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
    expect(result.current.errorMessage).toBeNull();
  });
});
