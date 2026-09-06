import { normalizePreviewText } from '../../../src/services/agents/lifecycle/runText';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

describe('normalizePreviewText', () => {
  it('returns short text unchanged (collapsing whitespace)', () => {
    expect(normalizePreviewText('  a   b  ')).toBe('a b');
  });

  it('returns undefined for empty input', () => {
    expect(normalizePreviewText('   ')).toBeUndefined();
    expect(normalizePreviewText(undefined)).toBeUndefined();
  });

  it('never splits a grapheme cluster when the default 220-char cut lands inside a probe', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const text = `${'a'.repeat(210)}${probe.repeat(15)}`;
      const result = normalizePreviewText(text);
      expectGraphemeSafe(result ?? '');
    }
  });
});
