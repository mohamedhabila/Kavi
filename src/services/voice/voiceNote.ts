import { Directory, File, Paths } from 'expo-file-system';
import type { Attachment } from '../../types/attachment';
import { generateId } from '../../utils/id';

const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  aac: 'audio/aac',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  mp4: 'audio/mp4',
  mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'audio/webm',
};

const DEFAULT_VOICE_NOTE_EXTENSION = 'm4a';
const DEFAULT_WAVEFORM_LEVELS = [
  0.28, 0.36, 0.5, 0.66, 0.58, 0.42, 0.34, 0.48, 0.62, 0.54, 0.38, 0.3,
];
const MAX_PERSISTED_WAVEFORM_LEVELS = 32;
const VOICE_NOTES_DIRECTORY_NAME = 'voice-notes';

function normalizeMeteringLevelValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.18;
  }

  return Math.min(1, Math.max(0.08, value));
}

function getFileExtension(uri: string): string {
  const match = uri
    .split(/[?#]/, 1)[0]
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/i);
  return match?.[1] || DEFAULT_VOICE_NOTE_EXTENSION;
}

function resolveAudioMimeType(file: File, uri: string): string {
  const fileType =
    typeof file.type === 'string' && file.type.trim().length > 0 ? file.type.trim() : '';
  if (fileType) {
    return fileType;
  }

  return (
    AUDIO_MIME_BY_EXTENSION[getFileExtension(uri)] ||
    AUDIO_MIME_BY_EXTENSION[DEFAULT_VOICE_NOTE_EXTENSION]
  );
}

function getVoiceNotesDirectory(): Directory {
  const directory = new Directory(Paths.document, VOICE_NOTES_DIRECTORY_NAME);
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

export function normalizeVoiceMeteringLevel(metering?: number): number {
  if (!Number.isFinite(metering)) {
    return 0.18;
  }

  const clamped = Math.max(-60, Math.min(0, metering as number));
  return normalizeMeteringLevelValue(0.12 + ((clamped + 60) / 60) * 0.88);
}

export function compactVoiceWaveformLevels(samples: number[], targetCount = 24): number[] {
  if (targetCount <= 0) {
    return [];
  }

  const normalized = samples
    .filter((value) => Number.isFinite(value))
    .map((value) => normalizeMeteringLevelValue(value));

  if (normalized.length === 0) {
    return DEFAULT_WAVEFORM_LEVELS.slice(0, Math.min(DEFAULT_WAVEFORM_LEVELS.length, targetCount));
  }

  if (normalized.length <= targetCount) {
    return normalized;
  }

  const result: number[] = [];
  for (let index = 0; index < targetCount; index += 1) {
    const start = Math.floor((index / targetCount) * normalized.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / targetCount) * normalized.length));
    const segment = normalized.slice(start, end);
    const peak = segment.reduce((maxValue, value) => Math.max(maxValue, value), 0.08);
    result.push(normalizeMeteringLevelValue(peak));
  }

  return result;
}

export function deleteVoiceNoteFile(uri: string | null | undefined): void {
  if (!uri) {
    return;
  }

  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Best-effort cleanup only.
  }
}

export function persistVoiceNoteAttachment(params: {
  sourceUri: string;
  durationMs: number;
  transcript: string;
  waveformLevels?: number[];
}): Attachment {
  const transcript = params.transcript.trim();
  const sourceFile = new File(params.sourceUri);
  const extension = getFileExtension(params.sourceUri);
  const persistedFile = new File(
    getVoiceNotesDirectory(),
    `voice-note-${Date.now()}-${generateId()}.${extension}`,
  );

  try {
    sourceFile.move(persistedFile);
  } catch {
    sourceFile.copy(persistedFile);
    deleteVoiceNoteFile(params.sourceUri);
  }

  return {
    id: generateId(),
    type: 'audio',
    uri: persistedFile.uri,
    name: persistedFile.name,
    mimeType: resolveAudioMimeType(persistedFile, persistedFile.uri),
    size: persistedFile.size,
    durationMs: Math.max(0, Math.round(params.durationMs)),
    transcript,
    waveformLevels: compactVoiceWaveformLevels(
      params.waveformLevels ?? [],
      MAX_PERSISTED_WAVEFORM_LEVELS,
    ),
  };
}
