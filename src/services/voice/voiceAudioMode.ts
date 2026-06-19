export async function setVoiceAudioMode(mode: 'recording' | 'playback'): Promise<void> {
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
