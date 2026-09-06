import { boundLocalEvidenceText } from '../../../src/services/memory/localEvidenceText';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

describe('boundLocalEvidenceText', () => {
  it('returns the trimmed value unchanged when within budget', () => {
    expect(boundLocalEvidenceText('  short text  ', 100)).toEqual({
      value: 'short text',
      truncated: false,
    });
  });

  it('returns null for empty/whitespace-only input', () => {
    expect(boundLocalEvidenceText('   ', 100)).toEqual({ value: null, truncated: false });
    expect(boundLocalEvidenceText(null, 100)).toEqual({ value: null, truncated: false });
  });

  it('never splits a grapheme cluster when the cut lands inside a probe', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const value = `${'v'.repeat(90)}${probe.repeat(15)}`;
      const result = boundLocalEvidenceText(value, 100);
      expect(result.truncated).toBe(true);
      expectGraphemeSafe(result.value ?? '');
    }
  });
});
