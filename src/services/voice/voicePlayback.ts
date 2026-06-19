import { getSecure } from '../storage/SecureStorage';
import type { SpeechBackendConfig } from './voiceBackend';
import { resolveSpeechBackend } from './voiceBackend';
import { setVoiceAudioMode } from './voiceAudioMode';
import { getErrorMessageWithCauses } from './voiceErrors';
import { unrefTimerIfSupported } from '../../utils/timers';

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

export type TTSProvider = 'auto' | 'system' | 'openai' | 'elevenlabs';

const DEFAULT_PLAYBACK_RATE = 1.08;
const REMOTE_TTS_PLAYBACK_TIMEOUT_MS = 120_000;

export async function speakWithPreferredProvider(text: string): Promise<void> {
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

export async function speakWithSystem(text: string): Promise<void> {
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

function applyPlaybackConfig(player: VoiceAudioPlayer, config?: PlaybackConfig): void {
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

export async function speakWithSpeechBackend(
  text: string,
  backend: SpeechBackendConfig,
): Promise<void> {
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

export async function speakWithOpenAI(text: string): Promise<void> {
  const backend = await resolveSpeechBackend();
  if (!backend) throw new Error('No compatible speech provider available for TTS');
  await speakWithSpeechBackend(text, backend);
}

export async function speakWithElevenLabs(text: string, providedApiKey?: string): Promise<void> {
  const apiKey = providedApiKey || (await getSecure('ELEVENLABS_API_KEY'));
  if (!apiKey) throw new Error('ElevenLabs API key required for TTS');

  const voiceId = (await getSecure('ELEVENLABS_VOICE_ID')) || 'pNInz6obpgDQGcFmaJgB';
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

export async function stopSpeaking(): Promise<void> {
  try {
    const Speech = require('expo-speech');
    await Speech.stop();
  } catch {
    // Stopping speech is best-effort because platform speech modules may be unavailable.
  }
}
