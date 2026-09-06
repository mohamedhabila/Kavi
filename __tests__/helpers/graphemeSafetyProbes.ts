// ---------------------------------------------------------------------------
// Shared grapheme-safety probes for truncation regression tests
// ---------------------------------------------------------------------------
// Every truncation site migrated to `src/utils/graphemes.ts` needs the same
// three positioned probes (a surrogate-pair emoji, a ZWJ family emoji, and a
// Devanagari/Arabic combining sequence) and the same two invariants (no lone
// surrogate, no dangling combining mark left at a cut boundary). Centralizing
// them keeps every migrated-file test asserting the same thing the same way.
// ---------------------------------------------------------------------------

import { segmentGraphemes } from '../../src/utils/graphemes';

/** A single astral-plane character — U+1D306, encoded as a UTF-16 surrogate pair. */
export const SURROGATE_PAIR_EMOJI = '𝌆';
/** man ZWJ woman ZWJ girl ZWJ boy — a four-codepoint emoji ZWJ family sequence. */
export const ZWJ_FAMILY_EMOJI = '👨‍👩‍👧‍👦';
/** Devanagari virama-joined consonant conjuncts. */
export const DEVANAGARI_COMBINING_TEXT = 'क्षत्रिय';
/** Arabic base letters with combining diacritics (harakat). */
export const ARABIC_COMBINING_TEXT = 'بِسْمِ';

/** True when `text` contains a UTF-16 surrogate code unit with no matching partner. */
export function hasLoneSurrogate(text: string): boolean {
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

/** True when the first or last grapheme cluster of `text` is a bare combining mark. */
export function hasDanglingCombiningMark(text: string): boolean {
  if (!text) return false;
  const clusters = segmentGraphemes(text);
  const boundaryClusters = [clusters[0] ?? '', clusters[clusters.length - 1] ?? ''];
  return boundaryClusters.some((cluster) => /^\p{M}+$/u.test(cluster));
}

/**
 * Assert the two invariants a grapheme-safe truncation output must always
 * satisfy: no orphaned UTF-16 surrogate, and no combining mark stranded away
 * from its base letter at a cut boundary. Call this on the output of any
 * migrated truncation function inside a `describe.each` sweep over cut
 * lengths that walks across a positioned probe string.
 */
export function expectGraphemeSafe(text: string): void {
  expect(hasLoneSurrogate(text)).toBe(false);
  expect(hasDanglingCombiningMark(text)).toBe(false);
}

/** Build a text with a positioned probe roughly in the middle of filler content. */
export function buildProbeText(probe: string, filler = 'lorem ipsum dolor sit amet '): string {
  return `${filler.repeat(3)}${probe}${filler.repeat(3)}`;
}
