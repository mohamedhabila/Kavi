import { setVoiceAudioMode } from './voiceAudioMode';
import { getErrorMessageWithCauses } from './voiceErrors';
import { stopSpeaking } from './voicePlayback';

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
