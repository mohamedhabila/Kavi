// ---------------------------------------------------------------------------
// Kavi — Voice I/O Service
// ---------------------------------------------------------------------------
// STT via OpenAI Whisper API, TTS via expo-speech or OpenAI TTS API.

import { getWhisperModel, resolveSpeechBackend } from './voiceBackend';
import {
  buildUploadFileDescriptor,
  MAX_TRANSCRIPTION_FILE_SIZE_BYTES,
  waitForRecordedAudioFile,
} from './voiceAudioFiles';
import {
  speakWithElevenLabs,
  speakWithOpenAI,
  speakWithPreferredProvider,
  speakWithSystem,
} from './voicePlayback';
import type { TTSProvider } from './voicePlayback';

export type { RecordedAudioFileSnapshot } from './voiceAudioFiles';
export { waitForRecordedAudioFile } from './voiceAudioFiles';
export type { TTSProvider } from './voicePlayback';
export {
  ensureRecordingPermission,
  getRecordingStatus,
  isRecording,
  startRecording,
  stopRecording,
} from './voiceRecording';
export type {
  RecordingPermissionResult,
  RecordingStatusSnapshot,
} from './voiceRecording';
export { stopSpeaking } from './voicePlayback';

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
