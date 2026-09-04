// ---------------------------------------------------------------------------
// Tests — Voice Playback (speakWithSystem locale-aware language)
// ---------------------------------------------------------------------------

import { speakWithSystem } from '../../src/services/voice/voicePlayback';
import { i18n } from '../../src/i18n/manager';

const mockSpeak = jest.fn((_text: string, options: { onDone?: () => void }) => {
  options.onDone?.();
});

jest.mock('expo-speech', () => ({
  speak: (text: string, options: any) => mockSpeak(text, options),
  stop: jest.fn(),
}));

beforeEach(async () => {
  mockSpeak.mockClear();
  await i18n.setLocale('en');
});

describe('speakWithSystem', () => {
  it('uses the BCP-47 tag for the current effective app locale by default', async () => {
    await i18n.setLocale('ja');

    await speakWithSystem('こんにちは');

    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0]?.[1]?.language).toBe('ja-JP');
  });

  it('defaults to en-US when the app locale is English', async () => {
    await speakWithSystem('Hello there');

    expect(mockSpeak.mock.calls[0]?.[1]?.language).toBe('en-US');
  });

  it('an explicit language override wins over the app locale', async () => {
    await i18n.setLocale('ja');

    await speakWithSystem('Bonjour', 'fr-FR');

    expect(mockSpeak.mock.calls[0]?.[1]?.language).toBe('fr-FR');
  });

  it('ignores a blank override and falls back to the app locale', async () => {
    await i18n.setLocale('de');

    await speakWithSystem('Hallo', '   ');

    expect(mockSpeak.mock.calls[0]?.[1]?.language).toBe('de-DE');
  });
});
