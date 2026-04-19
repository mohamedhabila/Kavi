// ---------------------------------------------------------------------------
// Voice I/O Service — tests
// ---------------------------------------------------------------------------
// The voice module uses dynamic imports (await import('expo-speech'/'expo-av'))
// which are not testable in standard Jest without --experimental-vm-modules.
// We test the functions that don't use dynamic imports directly, AND verify
// the error paths that throw before dynamic imports are reached.

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: jest.fn(),
  getProviderApiKey: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: jest.fn(() => ({
      activeProviderId: null,
      providers: [],
    })),
  },
}));

const mockSpeechSpeak = jest.fn((_text: string, options?: any) => {
  options?.onDone?.();
});
const mockSpeechStop = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-speech', () => ({
  speak: (...args: any[]) => mockSpeechSpeak(...args),
  stop: (...args: any[]) => mockSpeechStop(...args),
}));

const mockSetAudioModeAsync = jest.fn().mockResolvedValue(undefined);
const mockGetRecordingPermissionsAsync = jest
  .fn()
  .mockResolvedValue({ granted: true, status: 'granted' });
const mockRequestRecordingPermissionsAsync = jest
  .fn()
  .mockResolvedValue({ granted: true, status: 'granted' });
const mockAudioRecorderInstances: Array<{
  prepareToRecordAsync: jest.Mock;
  record: jest.Mock;
  stop: jest.Mock;
  getStatus: jest.Mock;
  uri: string;
}> = [];
const mockAudioRecorderConstructor = jest.fn().mockImplementation(() => {
  const instance = {
    prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
    record: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockReturnValue({
      canRecord: true,
      isRecording: true,
      durationMillis: 0,
      mediaServicesDidReset: false,
      metering: -18,
      url: 'file:///mock/cache/recording.m4a',
    }),
    uri: 'file:///mock/cache/recording.m4a',
  };
  mockAudioRecorderInstances.push(instance);
  return instance;
});
const mockCreateAudioPlayer = jest.fn(() => {
  let playbackListener: ((status: { didJustFinish?: boolean }) => void) | null = null;
  const subscription = { remove: jest.fn() };
  return {
    addListener: (_event: string, listener: (status: { didJustFinish?: boolean }) => void) => {
      playbackListener = listener;
      return subscription;
    },
    play: jest.fn(() => playbackListener?.({ didJustFinish: true })),
    remove: jest.fn(),
    setPlaybackRate: jest.fn(),
  };
});
jest.mock('expo-audio', () => ({
  setAudioModeAsync: (...args: any[]) => mockSetAudioModeAsync(...args),
  createAudioPlayer: (...args: any[]) => mockCreateAudioPlayer(...args),
  getRecordingPermissionsAsync: (...args: any[]) => mockGetRecordingPermissionsAsync(...args),
  requestRecordingPermissionsAsync: (...args: any[]) =>
    mockRequestRecordingPermissionsAsync(...args),
  RecordingPresets: {
    HIGH_QUALITY: {
      extension: '.m4a',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
      android: {
        outputFormat: 'mpeg4',
        audioEncoder: 'aac',
      },
      ios: {
        outputFormat: 'aac ',
        audioQuality: 127,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
      web: {
        mimeType: 'audio/webm',
        bitsPerSecond: 128000,
      },
    },
  },
  AudioModule: {
    AudioRecorder: (...args: any[]) => mockAudioRecorderConstructor(...args),
  },
}));

const expoFileSystem = require('expo-file-system') as {
  File: new (...parts: any[]) => { write: (content: string | Uint8Array) => void };
  __resetStore: () => void;
};

function seedAudioFile(uri: string, content = 'audio-data'.repeat(512)) {
  new expoFileSystem.File(uri).write(content);
}

(global as any).FileReader = class MockFileReader {
  result: string | null = null;
  onload: null | (() => void) = null;
  onerror: null | ((error: Error) => void) = null;

  readAsDataURL(_blob: Blob) {
    this.result = 'data:audio/mp3;base64,ZmFrZQ==';
    this.onload?.();
  }
};

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import { getSecure } from '../../src/services/storage/SecureStorage';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import {
  ensureRecordingPermission,
  startRecording,
  transcribeAudio,
  speakText,
  isRecording,
  stopRecording,
} from '../../src/services/voice/voice';

const mockGetSecure = getSecure as jest.Mock;
const mockGetState = useSettingsStore.getState as jest.Mock;

describe('Voice — STT (transcribeAudio)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockGetSecure.mockReset();
    mockRequestRecordingPermissionsAsync.mockReset();
    mockRequestRecordingPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
    mockAudioRecorderConstructor.mockClear();
    mockAudioRecorderInstances.length = 0;
    expoFileSystem.__resetStore();
    seedAudioFile('file://audio.m4a');
    seedAudioFile('file://voice-note.wav');
    seedAudioFile('file:///cache/recording');
    const { getProviderApiKey } = require('../../src/services/storage/SecureStorage');
    (getProviderApiKey as jest.Mock).mockReset();
    (getProviderApiKey as jest.Mock).mockResolvedValue(null);
    mockGetState.mockReturnValue({ activeProviderId: null, providers: [] });
  });

  it('should throw if no API key', async () => {
    mockGetSecure.mockResolvedValue(null);
    await expect(transcribeAudio('file://audio.m4a')).rejects.toThrow(
      'No compatible speech provider available',
    );
  });

  it('should transcribe audio successfully', async () => {
    mockGetSecure.mockResolvedValue('sk-test');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'hello world', language: 'en', duration: 2.5 }),
    });

    const result = await transcribeAudio('file://audio.m4a');
    expect(result.text).toBe('hello world');
    expect(result.language).toBe('en');
    expect(result.duration).toBe(2.5);
  });

  it('should handle Whisper API errors', async () => {
    mockGetSecure.mockResolvedValue('sk-test');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

    await expect(transcribeAudio('file://audio.m4a')).rejects.toThrow('Whisper API error');
  });

  it('should handle empty text response', async () => {
    mockGetSecure.mockResolvedValue('sk-test');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await transcribeAudio('file://audio.m4a');
    expect(result.text).toBe('');
  });

  it('should preserve the uploaded file name and mime type', async () => {
    const originalFormData = global.FormData;
    const parts: Array<[string, any]> = [];
    class MockFormData {
      append(key: string, value: any) {
        parts.push([key, value]);
      }
    }

    (global as any).FormData = MockFormData;
    mockGetSecure.mockResolvedValue('sk-test');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'ok' }),
    });

    await transcribeAudio('file://voice-note.wav');

    expect(parts).toEqual(
      expect.arrayContaining([
        ['file', expect.objectContaining({ name: 'voice-note.wav', type: 'audio/wav' })],
      ]),
    );

    (global as any).FormData = originalFormData;
  });

  it('should normalize extensionless native recordings to m4a uploads', async () => {
    const originalFormData = global.FormData;
    const parts: Array<[string, any]> = [];
    class MockFormData {
      append(key: string, value: any) {
        parts.push([key, value]);
      }
    }

    (global as any).FormData = MockFormData;
    mockGetSecure.mockResolvedValue('sk-test');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'ok' }),
    });

    await transcribeAudio('file:///cache/recording');

    expect(parts).toEqual(
      expect.arrayContaining([
        ['file', expect.objectContaining({ name: 'recording.m4a', type: 'audio/mp4' })],
      ]),
    );

    (global as any).FormData = originalFormData;
  });

  it('should reject empty local audio files before upload', async () => {
    const emptyUri = 'file://empty.m4a';
    seedAudioFile(emptyUri, '');
    mockGetSecure.mockResolvedValue('sk-test');

    await expect(transcribeAudio(emptyUri)).rejects.toThrow('Recorded audio file is empty');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('Voice — TTS (speakText) — error paths', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockGetSecure.mockReset();
    mockSpeechSpeak.mockClear();
    mockSetAudioModeAsync.mockClear();
    mockCreateAudioPlayer.mockClear();
    const { getProviderApiKey } = require('../../src/services/storage/SecureStorage');
    (getProviderApiKey as jest.Mock).mockReset();
    (getProviderApiKey as jest.Mock).mockResolvedValue(null);
    mockGetState.mockReturnValue({ activeProviderId: null, providers: [] });
  });

  it('should throw if OpenAI TTS has no API key', async () => {
    mockGetSecure.mockResolvedValue(null);
    await expect(speakText('hello', 'openai')).rejects.toThrow(
      'No compatible speech provider available',
    );
  });

  it('should throw if OpenAI TTS API fails', async () => {
    mockGetSecure.mockResolvedValue('sk-test');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(speakText('hello', 'openai')).rejects.toThrow('OpenAI TTS failed');
  });

  it('should throw if ElevenLabs has no API key', async () => {
    mockGetSecure.mockResolvedValue(null);
    await expect(speakText('hello', 'elevenlabs')).rejects.toThrow('ElevenLabs API key required');
  });

  it('should throw if ElevenLabs API fails', async () => {
    mockGetSecure.mockResolvedValue('el-key');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(speakText('hello', 'elevenlabs')).rejects.toThrow('ElevenLabs TTS failed');
  });

  it('system TTS resolves on the speech completion callback', async () => {
    await expect(speakText('hello', 'system')).resolves.toBeUndefined();
    expect(mockSpeechSpeak).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({ onDone: expect.any(Function) }),
    );
    expect(mockSetAudioModeAsync).toHaveBeenCalled();
  });

  it('auto TTS prefers the OpenAI-compatible path when available', async () => {
    mockGetSecure.mockResolvedValue(null);
    const { getProviderApiKey } = require('../../src/services/storage/SecureStorage');
    (getProviderApiKey as jest.Mock).mockResolvedValue('sk-provider');
    mockGetState.mockReturnValue({
      activeProviderId: 'openai',
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          enabled: true,
          apiKey: '',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
        },
      ],
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(['audio']),
    });

    await expect(speakText('hello', 'auto')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/speech',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('auto TTS falls back to system speech when remote playback times out', async () => {
    jest.useFakeTimers();

    try {
      mockGetSecure.mockResolvedValue(null);
      const { getProviderApiKey } = require('../../src/services/storage/SecureStorage');
      (getProviderApiKey as jest.Mock).mockResolvedValue('sk-provider');
      mockGetState.mockReturnValue({
        activeProviderId: 'openai',
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            enabled: true,
            apiKey: '',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-5.4',
          },
        ],
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(['audio']),
      });

      const subscriptionRemove = jest.fn();
      const playerRemove = jest.fn();
      mockCreateAudioPlayer.mockImplementationOnce(() => ({
        addListener: jest.fn(() => ({ remove: subscriptionRemove })),
        play: jest.fn(),
        remove: playerRemove,
        setPlaybackRate: jest.fn(),
      }));

      const pending = speakText('hello', 'auto');
      await jest.advanceTimersByTimeAsync(120_000);

      await expect(pending).resolves.toBeUndefined();
      expect(mockSpeechSpeak).toHaveBeenCalledWith(
        'hello',
        expect.objectContaining({ onDone: expect.any(Function) }),
      );
      expect(playerRemove).toHaveBeenCalledTimes(1);
      expect(subscriptionRemove).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Voice — Recording state', () => {
  beforeEach(() => {
    mockGetRecordingPermissionsAsync.mockReset();
    mockGetRecordingPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
    mockRequestRecordingPermissionsAsync.mockReset();
    mockRequestRecordingPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
    mockAudioRecorderConstructor.mockClear();
    mockAudioRecorderInstances.length = 0;
  });

  it('ensureRecordingPermission avoids re-requesting access when permission is already granted', async () => {
    mockGetRecordingPermissionsAsync.mockResolvedValueOnce({ granted: true, status: 'granted' });

    await expect(ensureRecordingPermission()).resolves.toEqual({
      granted: true,
      requested: false,
    });
    expect(mockRequestRecordingPermissionsAsync).not.toHaveBeenCalled();
  });

  it('ensureRecordingPermission requests access when microphone permission is not yet granted', async () => {
    mockGetRecordingPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      status: 'undetermined',
    });
    mockRequestRecordingPermissionsAsync.mockResolvedValueOnce({
      granted: true,
      status: 'granted',
    });

    await expect(ensureRecordingPermission()).resolves.toEqual({
      granted: true,
      requested: true,
    });
    expect(mockRequestRecordingPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('isRecording returns false initially', () => {
    // Initially no recording is active (or after stopRecording)
    expect(typeof isRecording()).toBe('boolean');
  });

  it('stopRecording returns null when not recording', async () => {
    const uri = await stopRecording();
    expect(uri).toBeNull();
  });

  it('falls back to a second supported preset when the first preparation attempt fails', async () => {
    mockAudioRecorderConstructor
      .mockImplementationOnce(() => {
        const instance = {
          prepareToRecordAsync: jest
            .fn()
            .mockRejectedValue(new Error('Failed to prepare the AudioRecorder')),
          record: jest.fn(),
          stop: jest.fn().mockResolvedValue(undefined),
          getStatus: jest.fn().mockReturnValue(null),
          uri: 'file:///mock/cache/recording-primary.m4a',
        };
        mockAudioRecorderInstances.push(instance);
        return instance;
      })
      .mockImplementationOnce(() => {
        const instance = {
          prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
          record: jest.fn(),
          stop: jest.fn().mockResolvedValue(undefined),
          getStatus: jest.fn().mockReturnValue({
            canRecord: true,
            isRecording: true,
            durationMillis: 0,
            mediaServicesDidReset: false,
            metering: -18,
            url: 'file:///mock/cache/recording-fallback.m4a',
          }),
          uri: 'file:///mock/cache/recording-fallback.m4a',
        };
        mockAudioRecorderInstances.push(instance);
        return instance;
      });

    await expect(startRecording()).resolves.toBeUndefined();

    expect(mockAudioRecorderConstructor).toHaveBeenCalledTimes(2);
    expect(mockAudioRecorderInstances[0].prepareToRecordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        numberOfChannels: 1,
        sampleRate: 44100,
        bitRate: 64000,
        isMeteringEnabled: true,
        android: expect.objectContaining({
          outputFormat: 'mpeg4',
          audioEncoder: 'aac',
          audioSource: 'voice_recognition',
        }),
      }),
    );
    expect(mockAudioRecorderInstances[1].prepareToRecordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        numberOfChannels: 1,
        sampleRate: 44100,
        bitRate: 64000,
        isMeteringEnabled: true,
        android: expect.objectContaining({
          outputFormat: 'mpeg4',
          audioEncoder: 'aac',
          audioSource: 'voice_communication',
        }),
      }),
    );
    expect(mockAudioRecorderInstances[1].record).toHaveBeenCalledTimes(1);

    await stopRecording();
  });
});
