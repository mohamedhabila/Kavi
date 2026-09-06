import { truncateTranscriptText } from '../../../src/services/agents/lifecycle/sessionContextMessages';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

describe('truncateTranscriptText', () => {
  it('returns short text unchanged', () => {
    expect(truncateTranscriptText('short', 100)).toBe('short');
  });

  it('returns undefined for empty input', () => {
    expect(truncateTranscriptText(undefined, 100)).toBeUndefined();
  });

  it('never splits a grapheme cluster when the cut lands inside a probe', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const text = `${'t'.repeat(90)}${probe.repeat(15)}`;
      const result = truncateTranscriptText(text, 100);
      expectGraphemeSafe(result ?? '');
    }
  });
});
