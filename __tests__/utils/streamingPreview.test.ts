// ---------------------------------------------------------------------------
// Tests — Streaming preview truncation stays grapheme-safe
// ---------------------------------------------------------------------------
// Regression coverage: before the fix, `buildStreamingPreview` cut its
// char-window and char-count budgets at raw UTF-16 code-unit offsets, which
// could split a surrogate pair (emoji), a ZWJ family emoji sequence, or a
// base letter from its combining mark exactly at the cut boundary.
// ---------------------------------------------------------------------------

import { buildStreamingPreview } from '../../src/utils/streamingPreview';
import { segmentGraphemes } from '../../src/utils/graphemes';

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

function startsWithDanglingCombiningMark(text: string): boolean {
  const stripped = text.startsWith('…') ? text.slice(1) : text;
  const first = segmentGraphemes(stripped)[0] ?? '';
  return /^\p{M}+$/u.test(first);
}

describe('buildStreamingPreview', () => {
  it('returns the full text unchanged when within every budget', () => {
    expect(buildStreamingPreview('hello world')).toBe('hello world');
  });

  it('never produces a lone surrogate when the char-window cut lands inside a surrogate pair', () => {
    const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ';
    for (let padding = 0; padding <= 6; padding += 1) {
      const text = `${filler.repeat(3)}${' '.repeat(padding)}${ASTRAL_CHAR}${filler}`;
      const preview = buildStreamingPreview(text, { charWindow: 100 + padding, maxChars: 100 + padding });
      expect(hasLoneSurrogate(preview)).toBe(false);
    }
  });

  it('never splits an emoji ZWJ family sequence at the char-window or char-count cut', () => {
    const filler = 'the quick brown fox jumps over the lazy dog near the river bank each ';
    for (let padding = 0; padding <= 6; padding += 1) {
      const text = `${filler.repeat(3)}${' '.repeat(padding)}${FAMILY_EMOJI}${filler}`;
      const preview = buildStreamingPreview(text, { charWindow: 100 + padding, maxChars: 100 + padding });
      const strippedOfWholeSequences = preview.split(FAMILY_EMOJI).join('');
      expect(strippedOfWholeSequences.includes('‍')).toBe(false);
    }
  });

  it('never leaves a dangling combining mark at the start of the kept preview', () => {
    const filler = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu ';
    for (let padding = 0; padding <= 6; padding += 1) {
      const text = `${filler.repeat(3)}${' '.repeat(padding)}${DEVANAGARI_CONJUNCT_TEXT}${filler}`;
      const preview = buildStreamingPreview(text, { charWindow: 100 + padding, maxChars: 100 + padding });
      expect(startsWithDanglingCombiningMark(preview)).toBe(false);
    }
  });
});
