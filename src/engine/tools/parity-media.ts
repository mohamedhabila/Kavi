import * as ImagePicker from 'expo-image-picker';

import {
  startRecording,
  stopRecording,
  transcribeAudio,
  speakText,
  type TTSProvider,
} from '../../services/voice/voice';

export async function executeCameraSnap(args: {
  camera?: string;
  quality?: number;
}): Promise<string> {
  try {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: args.quality ?? 0.7,
      base64: true,
      cameraType:
        args.camera === 'front' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
    });

    if (result.canceled || !result.assets?.[0]) {
      return JSON.stringify({ status: 'cancelled' });
    }

    const asset = result.assets[0];
    return JSON.stringify({
      status: 'captured',
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      base64Length: asset.base64?.length || 0,
      mimeType: asset.mimeType || 'image/jpeg',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', error: message });
  }
}

export async function executeAudioTranscribe(args: {
  durationMs?: number;
  language?: string;
}): Promise<string> {
  const duration = args.durationMs || 5000;

  try {
    await startRecording();
    await new Promise((resolve) => setTimeout(resolve, duration));
    const audioUri = await stopRecording();

    if (!audioUri) {
      return JSON.stringify({ status: 'error', error: 'No audio recorded' });
    }

    const result = await transcribeAudio(audioUri, { language: args.language });
    return JSON.stringify({
      status: 'transcribed',
      text: result.text,
      language: result.language,
      duration: result.duration,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', error: message });
  }
}

export async function executeSpeak(args: { text: string; provider?: string }): Promise<string> {
  try {
    const provider = (args.provider || 'system') as TTSProvider;
    await speakText(args.text, provider);
    return JSON.stringify({
      status: 'spoken',
      textLength: args.text.length,
      provider,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', error: message });
  }
}