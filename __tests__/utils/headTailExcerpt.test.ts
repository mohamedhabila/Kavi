// ---------------------------------------------------------------------------
// Tests — Head/tail excerpt truncation stays grapheme-safe
// ---------------------------------------------------------------------------
// Regression coverage for the surrogate-pair/ZWJ/combining-mark splitting bug:
// before the fix, `buildHeadTailExcerpt` cut at raw UTF-16 code-unit offsets,
// which could split a surrogate pair (emoji), a ZWJ family emoji sequence, or
// a base letter from its combining mark when the cut landed inside one.
// ---------------------------------------------------------------------------

import { buildHeadTailExcerpt } from '../../src/utils/headTailExcerpt';
import { segmentGraphemes } from '../../src/utils/graphemes';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
  startsOnGraphemeBoundary,
} from '../helpers/graphemeTestFixtures';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦'; // man ZWJ woman ZWJ girl ZWJ boy
const DEVANAGARI_CONJUNCT_TEXT = 'क्षत्रिय';
const ASTRAL_CHAR = '𝌆'; // U+1D306, outside the BMP (surrogate pair)

function hasLoneSurrogate(text: string): boolean {
  const isWellFormed = (String.prototype as { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof isWellFormed === 'function') {
    return !isWellFormed.call(text);
  }
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function endsOrStartsWithDanglingCombiningMark(text: string): boolean {
  const clusters = segmentGraphemes(text);
  const boundaryClusters = [clusters[0] ?? '', clusters[clusters.length - 1] ?? ''];
  return boundaryClusters.some((cluster) => /^\p{M}+$/u.test(cluster));
}

describe('buildHeadTailExcerpt', () => {
  it('returns the original text unchanged when within budget', () => {
    expect(buildHeadTailExcerpt('hello', 20)).toBe('hello');
  });

  it('never produces a lone surrogate when a surrogate-pair emoji sits at the head or tail cut', () => {
    const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ';
    for (let padding = 0; padding <= 6; padding += 1) {
      const text = `${filler}${' '.repeat(padding)}${ASTRAL_CHAR}${filler}${ASTRAL_CHAR}${filler}`;
      const excerpt = buildHeadTailExcerpt(text, 60 + padding);
      expect(hasLoneSurrogate(excerpt)).toBe(false);
    }
  });

  it('never splits an emoji ZWJ family sequence at the head or tail cut', () => {
    const filler = 'the quick brown fox jumps over the lazy dog near the river bank each ';
    for (let padding = 0; padding <= 6; padding += 1) {
      const text = `${filler}${' '.repeat(padding)}${FAMILY_EMOJI}${filler}${FAMILY_EMOJI}${filler}`;
      const excerpt = buildHeadTailExcerpt(text, 60 + padding);
      // The ZWJ sequence must appear intact or not at all — never a
      // partially-joined fragment (which would render as separate glyphs).
      const zwjOccurrences = excerpt.split(FAMILY_EMOJI).length - 1;
      const strippedOfWholeSequences = excerpt.split(FAMILY_EMOJI).join('');
      expect(strippedOfWholeSequences.includes('‍')).toBe(false);
      expect(zwjOccurrences).toBeGreaterThanOrEqual(0);
    }
  });

  it('never leaves a dangling combining mark at the head or tail cut boundary', () => {
    const filler = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu ';
    for (let padding = 0; padding <= 6; padding += 1) {
      const text = `${filler}${' '.repeat(padding)}${DEVANAGARI_CONJUNCT_TEXT}${filler}${DEVANAGARI_CONJUNCT_TEXT}${filler}`;
      const excerpt = buildHeadTailExcerpt(text, 60 + padding);
      const [head, tail] = excerpt.split(/\n\.\.\. \[truncated \d+ chars\] \.\.\.\n/);
      expect(endsOrStartsWithDanglingCombiningMark(head ?? '')).toBe(false);
      expect(endsOrStartsWithDanglingCombiningMark(tail ?? '')).toBe(false);
    }
  });

  // Merged from the former `buildGraphemeSafeHeadTailExcerpt`
  // (src/engine/text/headTailExcerpt.ts, now deleted): that function was a
  // byte-for-byte duplicate of this one (same 65/35 head/tail split, same
  // notice format), so this file keeps the one name/home and both test
  // suites' coverage.
  it('keeps head and tail, drops the middle, and reports an omitted-chars notice', () => {
    const value = `${'H'.repeat(500)}${'M'.repeat(2000)}${'T'.repeat(500)}`;
    const result = buildHeadTailExcerpt(value, 400);

    expect(result).toContain('truncated');
    expect(result.startsWith('H')).toBe(true);
    expect(result.endsWith('T')).toBe(true);
    expect(result).not.toContain('M'.repeat(50));
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} at the head cut (fixture sweep)`, () => {
      const maxChars = 300;
      // Head keeps ~65% of the budget; place the cluster right at that seam.
      const headBoundary = Math.floor(maxChars * 0.65);
      const value = `${buildBoundaryStraddlingText(headBoundary, cluster, 0)}${'m'.repeat(2000)}${'t'.repeat(200)}`;

      const result = buildHeadTailExcerpt(value, maxChars);
      expectGraphemeSafe(result);
      const [head, tail] = result.split(/\n\.\.\. \[truncated \d+ chars\] \.\.\.\n/);
      expect(endsOnGraphemeBoundary(value, head ?? '')).toBe(true);
      if (tail !== undefined) {
        expect(startsOnGraphemeBoundary(value, tail)).toBe(true);
      }
    });

    it(`never splits ${name} at the tail cut (fixture sweep)`, () => {
      const maxChars = 300;
      const tailBoundary = Math.floor(maxChars * 0.35);
      const value = `${'h'.repeat(200)}${'m'.repeat(2000)}${buildBoundaryStraddlingText(tailBoundary, cluster, 0)}`;

      const result = buildHeadTailExcerpt(value, maxChars);
      expectGraphemeSafe(result);
      const [head, tail] = result.split(/\n\.\.\. \[truncated \d+ chars\] \.\.\.\n/);
      expect(endsOnGraphemeBoundary(value, head ?? '')).toBe(true);
      if (tail !== undefined) {
        expect(startsOnGraphemeBoundary(value, tail)).toBe(true);
      }
    });
  }
});
