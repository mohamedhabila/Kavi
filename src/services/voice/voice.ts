// ---------------------------------------------------------------------------
// Kavi — Voice I/O Service
// ---------------------------------------------------------------------------
// STT via OpenAI Whisper API, TTS via expo-speech or OpenAI TTS API.

import { File } from 'expo-file-system';
import { getSecure, getProviderApiKey } from '../storage/SecureStorage';
import { DEFAULT_OPENAI_BASE_URL } from '../../constants/api';
import type { LlmProviderConfig } from '../../types/provider';
import { unrefTimerIfSupported } from '../../utils/timers';

interface SpeechBackendConfig {
  apiKey: string;
  baseUrl: string;
  providerName: string;
}

interface UploadFileDescriptor {
  uri: string;
  name: string;
  type: string;
}

interface PlaybackConfig {
  playbackRate?: number;
}

interface VoiceAudioPlayer {
  addListener?: (
    eventName: string,
    listener: (status: { didJustFinish?: boolean }) => void,
  ) => { remove?: () => void } | void;
  play: () => void;
  remove: () => void;
  setPlaybackRate?: (rate: number, quality?: 'low' | 'medium' | 'high') => void;
  playbackRate?: number;
  shouldCorrectPitch?: boolean;
}

export interface RecordedAudioFileSnapshot {
  inspected: boolean;
  exists: boolean;
  sizeBytes: number;
}

const DEFAULT_RECORDING_FILE_NAME = 'recording.m4a';
const DEFAULT_RECORDING_MIME_TYPE = 'audio/mp4';
const MAX_TRANSCRIPTION_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const RECORDED_AUDIO_FILE_READY_TIMEOUT_MS = 300;
const RECORDED_AUDIO_FILE_READY_POLL_INTERVAL_MS = 50;
const REMOTE_TTS_PLAYBACK_TIMEOUT_MS = 120_000;
const SUPPORTED_TRANSCRIPTION_EXTENSIONS = new Set([
  'flac',
  'm4a',
  'mp3',
  'mp4',
  'mpeg',
  'mpga',
  'ogg',
  'wav',
  'webm',
]);

function isInspectableRecordedAudioUri(audioUri: string): boolean {
  return /^file:/i.test(audioUri);
}

function readRecordedAudioFileSnapshot(audioUri: string): RecordedAudioFileSnapshot {
  if (!isInspectableRecordedAudioUri(audioUri)) {
    return {
      inspected: false,
      exists: true,
      sizeBytes: 0,
    };
  }

  try {
    const file = new File(audioUri);
    return {
      inspected: true,
      exists: file.exists,
      sizeBytes: Math.max(0, file.size || 0),
    };
  } catch {
    return {
      inspected: true,
      exists: false,
      sizeBytes: 0,
    };
  }
}

async function waitForDuration(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    unrefTimerIfSupported(timer);
  });
}

export async function waitForRecordedAudioFile(
  audioUri: string,
  options?: {
    minimumBytes?: number;
    timeoutMs?: number;
    pollIntervalMs?: number;
  },
): Promise<RecordedAudioFileSnapshot> {
  const minimumBytes = Math.max(0, options?.minimumBytes ?? 1);
  const timeoutMs = Math.max(0, options?.timeoutMs ?? RECORDED_AUDIO_FILE_READY_TIMEOUT_MS);
  const pollIntervalMs = Math.max(
    10,
    options?.pollIntervalMs ?? RECORDED_AUDIO_FILE_READY_POLL_INTERVAL_MS,
  );

  let snapshot = readRecordedAudioFileSnapshot(audioUri);
  if (
    !snapshot.inspected ||
    (snapshot.exists && snapshot.sizeBytes >= minimumBytes) ||
    timeoutMs === 0
  ) {
    return snapshot;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await waitForDuration(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    snapshot = readRecordedAudioFileSnapshot(audioUri);
    if (!snapshot.inspected || (snapshot.exists && snapshot.sizeBytes >= minimumBytes)) {
      return snapshot;
    }
  }

  return snapshot;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
}

function getVoiceMimeType(audioUri: string): string {
  const match = audioUri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  const extension = match?.[1]?.toLowerCase();

  switch (extension) {
    case 'm4a':
    case 'mp4':
      return 'audio/mp4';
    case 'mp3':
    case 'mpeg':
    case 'mpga':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'webm':
      return 'audio/webm';
    case 'ogg':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
}

function buildUploadFileDescriptor(audioUri: string): UploadFileDescriptor {
  const rawFileName = audioUri.split('/').pop()?.split('?')[0]?.trim() || '';
  const normalizedFileName = rawFileName || DEFAULT_RECORDING_FILE_NAME;
  const extension = normalizedFileName.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  const fileName =
    extension && SUPPORTED_TRANSCRIPTION_EXTENSIONS.has(extension)
      ? normalizedFileName
      : DEFAULT_RECORDING_FILE_NAME;
  const type = getVoiceMimeType(fileName);

  return {
    uri: audioUri,
    name: fileName,
    type: type === 'application/octet-stream' ? DEFAULT_RECORDING_MIME_TYPE : type,
  };
}

function isSupportedSpeechProvider(provider: LlmProviderConfig): boolean {
  if (!provider.baseUrl) return false;

  try {
    const normalized = new URL(provider.baseUrl);
    const host = normalized.hostname.toLowerCase();

    if (host === 'api.openai.com' || host.endsWith('.openai.com')) return true;
    if (host === 'api.groq.com' || host.endsWith('.groq.com')) return true;
    return false;
  } catch {
    return false;
  }
}

function getWhisperModel(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === 'api.groq.com' || host.endsWith('.groq.com')) return 'whisper-large-v3-turbo';
  } catch {
    /* ignore */
  }
  return 'whisper-1';
}

async function getEnabledProviders(): Promise<LlmProviderConfig[]> {
  try {
    const { useSettingsStore } = require('../../store/useSettingsStore');
    const state = useSettingsStore.getState();
    const enabledProviders = state.providers.filter(
      (provider: LlmProviderConfig) => provider.enabled,
    );
    const activeProvider = enabledProviders.find(
      (provider: LlmProviderConfig) => provider.id === state.activeProviderId,
    );

    if (!activeProvider) return enabledProviders;

    return [
      activeProvider,
      ...enabledProviders.filter(
        (provider: LlmProviderConfig) => provider.id !== activeProvider.id,
      ),
    ];
  } catch {
    return [];
  }
}

async function resolveSpeechBackend(): Promise<SpeechBackendConfig | null> {
  const dedicated = await getSecure('OPENAI_API_KEY');
  if (dedicated) {
    return {
      apiKey: dedicated,
      baseUrl: DEFAULT_OPENAI_BASE_URL,
      providerName: 'OpenAI',
    };
  }

  const providers = await getEnabledProviders();
  for (const provider of providers) {
    if (!isSupportedSpeechProvider(provider)) continue;

    const key = await getProviderApiKey(provider.id);
    const apiKey = key || provider.apiKey;
    if (!apiKey) continue;

    return {
      apiKey,
      baseUrl: normalizeBaseUrl(provider.baseUrl),
      providerName: provider.name,
    };
  }

  return null;
}

// ── Speech-to-Text (Whisper API) ─────────────────────────────────────────

export interface STTResult {
  text: string;
  language?: string;
  duration?: number;
}

export async function transcribeAudio(
  audioUri: string,
  options?: { language?: string },
): Promise<STTResult> {
  const backend = await resolveSpeechBackend();
  if (!backend) {
    throw new Error(
      'No compatible speech provider available. Configure OpenAI or Groq in Settings.',
    );
  }

  const fileSnapshot = await waitForRecordedAudioFile(audioUri, { minimumBytes: 1 });
  if (fileSnapshot.inspected) {
    if (!fileSnapshot.exists) {
      throw new Error('Recorded audio file is unavailable');
    }

    if (fileSnapshot.sizeBytes <= 0) {
      throw new Error('Recorded audio file is empty');
    }

    if (fileSnapshot.sizeBytes > MAX_TRANSCRIPTION_FILE_SIZE_BYTES) {
      throw new Error('Audio file exceeds the 25 MB transcription limit');
    }
  }

  const upload = buildUploadFileDescriptor(audioUri);

  const formData = new FormData();
  formData.append('file', {
    uri: upload.uri,
    name: upload.name,
    type: upload.type,
  } as any);
  formData.append('model', getWhisperModel(backend.baseUrl));
  formData.append('response_format', 'json');
  if (options?.language) {
    formData.append('language', options.language);
  }

  const res = await fetch(`${backend.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${backend.apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return {
    text: data.text || '',
    language: data.language,
    duration: data.duration,
  };
}

// ── Text-to-Speech ───────────────────────────────────────────────────────

export type TTSProvider = 'auto' | 'system' | 'openai' | 'elevenlabs';

const DEFAULT_PLAYBACK_RATE = 1.08;

async function setVoiceAudioMode(mode: 'recording' | 'playback'): Promise<void> {
  const { setAudioModeAsync } = require('expo-audio');

  if (mode === 'recording') {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
      interruptionModeAndroid: 'doNotMix',
      shouldRouteThroughEarpiece: false,
    });
    return;
  }

  await setAudioModeAsync({
    allowsRecording: false,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    interruptionMode: 'doNotMix',
    interruptionModeAndroid: 'doNotMix',
    shouldRouteThroughEarpiece: false,
  });
}

async function speakWithPreferredProvider(text: string): Promise<void> {
  const attemptErrors: string[] = [];
  const elevenLabsApiKey = await getSecure('ELEVENLABS_API_KEY');
  if (elevenLabsApiKey) {
    try {
      await speakWithElevenLabs(text, elevenLabsApiKey);
      return;
    } catch (error) {
      attemptErrors.push(`ElevenLabs: ${getErrorMessageWithCauses(error)}`);
    }
  }

  const backend = await resolveSpeechBackend();
  if (backend) {
    try {
      await speakWithSpeechBackend(text, backend);
      return;
    } catch (error) {
      attemptErrors.push(`${backend.providerName}: ${getErrorMessageWithCauses(error)}`);
    }
  }

  try {
    await speakWithSystem(text);
  } catch (error) {
    if (attemptErrors.length === 0) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    throw new Error(
      [...attemptErrors, `System TTS: ${getErrorMessageWithCauses(error)}`].join(' | '),
    );
  }
}

function applyPlaybackConfig(
  player: {
    setPlaybackRate?: (rate: number, quality?: 'low' | 'medium' | 'high') => void;
    playbackRate?: number;
    shouldCorrectPitch?: boolean;
  },
  config?: PlaybackConfig,
): void {
  const playbackRate = config?.playbackRate ?? DEFAULT_PLAYBACK_RATE;

  if (typeof player.setPlaybackRate === 'function') {
    player.setPlaybackRate(playbackRate, 'high');
    return;
  }

  if ('playbackRate' in player) {
    player.playbackRate = playbackRate;
  }

  if ('shouldCorrectPitch' in player) {
    player.shouldCorrectPitch = true;
  }
}

export async function speakText(text: string, provider: TTSProvider = 'auto'): Promise<void> {
  switch (provider) {
    case 'auto':
      return speakWithPreferredProvider(text);
    case 'system':
      return speakWithSystem(text);
    case 'openai':
      return speakWithOpenAI(text);
    case 'elevenlabs':
      return speakWithElevenLabs(text);
  }
}

async function speakWithSystem(text: string): Promise<void> {
  try {
    const Speech = require('expo-speech');
    await setVoiceAudioMode('playback');
    await new Promise<void>((resolve, reject) => {
      Speech.speak(text, {
        language: 'en-US',
        pitch: 1.0,
        rate: 1.08,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: (error: any) => reject(error instanceof Error ? error : new Error(String(error))),
      });
    });
  } catch (err: unknown) {
    throw new Error(`System TTS failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('Failed to read audio response.'));
    reader.readAsDataURL(blob);
  });
}

async function playAudioPlayer(player: VoiceAudioPlayer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let subscription: { remove?: () => void } | void;

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      try {
        subscription?.remove?.();
      } catch {
        // Ignore listener cleanup failures during playback teardown.
      }
      try {
        player.remove();
      } catch {
        // Ignore player cleanup failures after the playback outcome is decided.
      }
    };

    const settle = (error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve();
    };

    timeoutHandle = setTimeout(() => {
      settle(new Error('Audio playback timed out'));
    }, REMOTE_TTS_PLAYBACK_TIMEOUT_MS);
    unrefTimerIfSupported(timeoutHandle);

    if (typeof player.addListener === 'function') {
      subscription = player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) {
          settle();
        }
      });
    }

    try {
      player.play();
    } catch (error) {
      settle(error);
    }
  });
}

async function playAudioBlob(blob: Blob, config?: PlaybackConfig): Promise<void> {
  const { createAudioPlayer } = require('expo-audio');
  const dataUrl = await blobToDataUrl(blob);
  const player = createAudioPlayer({ uri: dataUrl }) as VoiceAudioPlayer;
  applyPlaybackConfig(player, config);
  await playAudioPlayer(player);
}

async function speakWithSpeechBackend(text: string, backend: SpeechBackendConfig): Promise<void> {
  await setVoiceAudioMode('playback');

  const res = await fetch(`${backend.baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${backend.apiKey}`,
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text.slice(0, 4096),
      voice: 'alloy',
      response_format: 'mp3',
    }),
  });

  if (!res.ok) throw new Error(`OpenAI TTS failed: HTTP ${res.status}`);

  try {
    const blob = await res.blob();
    await playAudioBlob(blob);
  } catch (err: unknown) {
    throw new Error(`Audio playback failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function speakWithOpenAI(text: string): Promise<void> {
  const backend = await resolveSpeechBackend();
  if (!backend) throw new Error('No compatible speech provider available for TTS');
  await speakWithSpeechBackend(text, backend);
}

async function speakWithElevenLabs(text: string, providedApiKey?: string): Promise<void> {
  const apiKey = providedApiKey || (await getSecure('ELEVENLABS_API_KEY'));
  if (!apiKey) throw new Error('ElevenLabs API key required for TTS');

  const voiceId = (await getSecure('ELEVENLABS_VOICE_ID')) || 'pNInz6obpgDQGcFmaJgB'; // Adam (default)
  await setVoiceAudioMode('playback');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text: text.slice(0, 5000),
      model_id: 'eleven_turbo_v2_5',
      output_format: 'mp3_44100_128',
    }),
  });

  if (!res.ok) throw new Error(`ElevenLabs TTS failed: HTTP ${res.status}`);

  try {
    const blob = await res.blob();
    await playAudioBlob(blob);
  } catch (err: unknown) {
    throw new Error(`Audio playback failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Audio recording for STT ──────────────────────────────────────────────

let recording: any = null;

export interface RecordingStatusSnapshot {
  canRecord: boolean;
  isRecording: boolean;
  durationMillis: number;
  mediaServicesDidReset: boolean;
  metering?: number;
  url: string | null;
}

interface RecordingPreparationAttempt {
  label: string;
  options: Record<string, unknown>;
}

export interface RecordingPermissionResult {
  granted: boolean;
  requested: boolean;
}

function getErrorMessageWithCauses(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;

  while (current) {
    const message = current instanceof Error ? current.message.trim() : String(current).trim();
    if (message && !messages.includes(message)) {
      messages.push(message);
    }

    if (typeof current === 'object' && current !== null && 'cause' in current) {
      current = (current as { cause?: unknown }).cause;
      continue;
    }

    break;
  }

  return messages.join(' -> ');
}

function buildRecordingPreparationAttempts(recordingPresets: {
  HIGH_QUALITY?: Record<string, unknown>;
}): RecordingPreparationAttempt[] {
  const highQualityPreset = recordingPresets.HIGH_QUALITY || {};
  const androidPreset =
    typeof highQualityPreset === 'object' &&
    highQualityPreset !== null &&
    'android' in highQualityPreset
      ? (highQualityPreset as { android?: Record<string, unknown> }).android || {}
      : {};
  const meteredHighQuality = {
    ...highQualityPreset,
    isMeteringEnabled: true,
  };

  return [
    {
      label: 'voice_recognition_mono_high_quality',
      options: {
        ...meteredHighQuality,
        numberOfChannels: 1,
        bitRate: 64000,
        android: {
          ...androidPreset,
          audioSource: 'voice_recognition',
        },
      },
    },
    {
      label: 'voice_communication_mono_high_quality',
      options: {
        ...meteredHighQuality,
        numberOfChannels: 1,
        bitRate: 64000,
        android: {
          ...androidPreset,
          audioSource: 'voice_communication',
        },
      },
    },
    {
      label: 'mono_high_quality',
      options: {
        ...meteredHighQuality,
        numberOfChannels: 1,
        bitRate: 64000,
      },
    },
    {
      label: 'high_quality',
      options: meteredHighQuality,
    },
  ];
}

export async function ensureRecordingPermission(): Promise<RecordingPermissionResult> {
  const { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } = require('expo-audio');

  if (typeof getRecordingPermissionsAsync === 'function') {
    const existingPermission = await getRecordingPermissionsAsync();
    if (existingPermission?.granted) {
      return {
        granted: true,
        requested: false,
      };
    }
  }

  const requestedPermission = await requestRecordingPermissionsAsync();
  return {
    granted: Boolean(requestedPermission?.granted),
    requested: true,
  };
}

export async function startRecording(): Promise<void> {
  const { RecordingPresets, AudioModule, requestRecordingPermissionsAsync } = require('expo-audio');

  const perm = await requestRecordingPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Microphone permission denied');
  }

  await stopSpeaking();

  if (recording) {
    const activeRecording = recording;
    recording = null;

    try {
      await activeRecording.stop?.();
    } catch {
      // Ignore stale recorder cleanup failures before starting a new session.
    }
  }

  await setVoiceAudioMode('recording');

  const attempts = buildRecordingPreparationAttempts(RecordingPresets);
  const preparationErrors: string[] = [];

  for (const attempt of attempts) {
    const recorder = new AudioModule.AudioRecorder({});

    try {
      await recorder.prepareToRecordAsync(attempt.options);
      recorder.record();
      recording = recorder;
      return;
    } catch (error) {
      const detail = getErrorMessageWithCauses(error) || 'Unknown recorder preparation failure';
      preparationErrors.push(`${attempt.label}: ${detail}`);

      try {
        await recorder.stop?.();
      } catch {
        // Ignore cleanup failures for a recorder that never finished preparing.
      }
    }
  }

  await setVoiceAudioMode('playback');
  throw new Error(
    `Failed to prepare the audio recorder with supported presets (${preparationErrors.join('; ')})`,
  );
}

export function getRecordingStatus(): RecordingStatusSnapshot | null {
  if (!recording || typeof recording.getStatus !== 'function') {
    return null;
  }

  try {
    return recording.getStatus() as RecordingStatusSnapshot;
  } catch {
    return null;
  }
}

export async function stopRecording(): Promise<string | null> {
  if (!recording) return null;
  await recording.stop();
  const uri = recording.uri;
  recording = null;
  await setVoiceAudioMode('playback');
  return uri ?? null;
}

export function isRecording(): boolean {
  return recording !== null;
}

export async function stopSpeaking(): Promise<void> {
  try {
    const Speech = require('expo-speech');
    await Speech.stop();
  } catch {
    // Ignore
  }
}
