// ---------------------------------------------------------------------------
// Tests — Remote TTS request text stays grapheme-safe at its provider budget
// ---------------------------------------------------------------------------
// speakWithSpeechBackend / speakWithElevenLabs truncate the spoken text to a
// hard provider character budget (4096 / 5000 UTF-16 code units). Before the
// fix this was a raw `.slice(0, N)`, which could split a surrogate pair, a
// ZWJ emoji sequence, or a base letter from its combining mark exactly at the
// cut. Both requests fail fast (mocked non-ok fetch) before reaching audio
// playback, so only the outgoing request body needs to be inspected.
// ---------------------------------------------------------------------------

jest.mock('../../../src/services/voice/voiceAudioMode', () => ({
  setVoiceAudioMode: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/services/storage/SecureStorage', () => ({
  getSecure: jest.fn().mockResolvedValue(null),
}));

import { speakWithElevenLabs, speakWithSpeechBackend } from '../../../src/services/voice/voicePlayback';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

const PROBES = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];

describe('remote TTS request text truncation', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    (global as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });

  it('never splits a grapheme cluster at the 4096-code-unit OpenAI TTS budget', async () => {
    for (const probe of PROBES) {
      fetchMock.mockClear();
      const text = `${'t'.repeat(4090)}${probe.repeat(10)}`;
      await expect(
        speakWithSpeechBackend(text, { baseUrl: 'https://example.invalid', apiKey: 'key' }),
      ).rejects.toThrow('OpenAI TTS failed');
      const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as { input?: string };
      expect(body.input?.length).toBeLessThanOrEqual(4096);
      expectGraphemeSafe(body.input ?? '');
    }
  });

  it('never splits a grapheme cluster at the 5000-code-unit ElevenLabs TTS budget', async () => {
    for (const probe of PROBES) {
      fetchMock.mockClear();
      const text = `${'t'.repeat(4990)}${probe.repeat(10)}`;
      await expect(speakWithElevenLabs(text, 'api-key')).rejects.toThrow('ElevenLabs TTS failed');
      const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as { text?: string };
      expect(body.text?.length).toBeLessThanOrEqual(5000);
      expectGraphemeSafe(body.text ?? '');
    }
  });
});
