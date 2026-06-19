import { File } from 'expo-file-system';
import { unrefTimerIfSupported } from '../../utils/timers';

export interface RecordedAudioFileSnapshot {
  inspected: boolean;
  exists: boolean;
  sizeBytes: number;
}

export interface UploadFileDescriptor {
  uri: string;
  name: string;
  type: string;
}

const DEFAULT_RECORDING_FILE_NAME = 'recording.m4a';
const DEFAULT_RECORDING_MIME_TYPE = 'audio/mp4';
export const MAX_TRANSCRIPTION_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const RECORDED_AUDIO_FILE_READY_TIMEOUT_MS = 300;
const RECORDED_AUDIO_FILE_READY_POLL_INTERVAL_MS = 50;
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

export function buildUploadFileDescriptor(audioUri: string): UploadFileDescriptor {
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
