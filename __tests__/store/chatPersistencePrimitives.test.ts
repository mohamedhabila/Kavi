import {
  keepAnchoredTail,
  normalizeText,
  truncateText,
} from '../../src/store/chatPersistencePrimitives';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../helpers/graphemeSafetyProbes';

describe('truncateText', () => {
  it('returns the trimmed value unchanged when within budget', () => {
    expect(truncateText('  hello  ', 20)).toBe('hello');
  });

  it('returns undefined for empty/whitespace input', () => {
    expect(truncateText('   ', 20)).toBeUndefined();
    expect(truncateText(undefined, 20)).toBeUndefined();
  });

  it('never splits a grapheme cluster when the cut lands inside a probe', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const value = `${'v'.repeat(150)}${probe.repeat(15)}`;
      const result = truncateText(value, 160);
      expectGraphemeSafe(result ?? '');
    }
  });
});

describe('normalizeText', () => {
  it('trims and returns undefined for empty input', () => {
    expect(normalizeText('  hi  ')).toBe('hi');
    expect(normalizeText('   ')).toBeUndefined();
  });
});

describe('keepAnchoredTail', () => {
  it('keeps the first item plus the most recent tail items when over budget', () => {
    const items = [1, 2, 3, 4, 5];
    expect(keepAnchoredTail(items, 3)).toEqual([1, 4, 5]);
  });
});
