// ---------------------------------------------------------------------------
// Shared fixtures for grapheme-safety regression tests
// ---------------------------------------------------------------------------
// Every call site migrated off raw `.slice`/`.substring` truncation onto the
// grapheme-safe helpers in `src/utils/graphemeBoundary.ts` and
// `src/utils/graphemes.ts` gets a test built from these fixtures: a
// surrogate-pair emoji, a ZWJ family emoji, and a combining sequence
// (Devanagari and Arabic), each placed so a naive UTF-16 code-unit cut at the
// site's real budget would have split it. These assertions fail against the
// pre-migration `.slice(0, N)` code and pass against the migrated code.
//
// `expectGraphemeSafe` / `hasDanglingTrailingVirama` / etc. are pattern-based
// oracles: they catch a lone surrogate or a dangling mark/virama left at a
// seam, but they cannot catch every mis-cut. Two gaps, found empirically:
//   1. Keep-first-N truncation that cuts a 3-codepoint Devanagari conjunct
//      down to just its base consonant produces a perfectly valid string (no
//      dangling virama), so the pattern oracle never trips even though the
//      cut split a real grapheme cluster.
//   2. Keep-first-N truncation of an Arabic base+combining-mark cluster can
//      only ever *drop* the trailing mark, never leave one dangling, so a
//      "no dangling mark" oracle can never fail for that shape — the actual
//      defect (ending mid-cluster instead of on a cluster boundary) goes
//      undetected.
// `endsOnGraphemeBoundary` / `startsOnGraphemeBoundary` below are the
// structural fix: they segment both strings with `segmentGraphemes` and
// require `output` to be exactly a prefix (or, for tail truncation, a
// suffix) of `input`'s cluster sequence — so any mid-cluster cut fails
// regardless of which fixture shape produced it.

import { segmentGraphemes } from '../../src/utils/graphemes';

/** U+1F600 GRINNING FACE — a single surrogate pair, 2 UTF-16 code units. */
export const SURROGATE_PAIR_EMOJI = '😀';

/** Man + ZWJ + Woman + ZWJ + Girl + ZWJ + Boy — one grapheme, 4 codepoints joined by ZWJ. */
export const ZWJ_FAMILY_EMOJI = '👨‍👩‍👧‍👦';

/** Devanagari "kṣa" conjunct: KA + VIRAMA + SSA — one akshara, 3 codepoints. */
export const DEVANAGARI_CONJUNCT = 'क्ष';

/** Arabic LAM + FATHA — a base letter with a combining diacritic. */
export const ARABIC_COMBINING = 'لَ';

export const GRAPHEME_CLUSTER_FIXTURES: ReadonlyArray<{ name: string; cluster: string }> = [
  { name: 'a surrogate-pair emoji', cluster: SURROGATE_PAIR_EMOJI },
  { name: 'a ZWJ family emoji', cluster: ZWJ_FAMILY_EMOJI },
  { name: 'a Devanagari combining conjunct', cluster: DEVANAGARI_CONJUNCT },
  { name: 'an Arabic combining sequence', cluster: ARABIC_COMBINING },
];

/**
 * Build a string of ASCII filler code units, followed by `cluster`, followed
 * by more filler — sized so a naive `text.slice(0, boundary)` lands partway
 * into `cluster`, splitting it. `cluster` must be >= 2 UTF-16 code units
 * (true of every fixture above) for the split to be reachable at all.
 *
 * `cutOffset` controls exactly how far into `cluster` the naive cut lands,
 * counting UTF-16 code units back from `cluster`'s end: the filler prefix is
 * `boundary - cutOffset` code units, so the naive slice keeps that many
 * filler units plus the first `cutOffset` code units of `cluster`. It
 * defaults to `cluster.length - 1` — the naive cut keeps every code unit of
 * `cluster` *except the last* — which is the most discriminating placement:
 * a surrogate pair or ZWJ-joined emoji is left with a lone leading/trailing
 * surrogate, and a virama-joined conjunct (e.g. Devanagari "क्ष") is left
 * with its virama dangling instead of quietly dropping down to a lone,
 * validly-standalone base consonant. Pass an explicit `cutOffset` (e.g. `1`,
 * the old default) for a caller that needs the naive cut to keep only the
 * cluster's first code unit instead.
 */
export function buildBoundaryStraddlingText(
  boundary: number,
  cluster: string,
  tailLength = 40,
  cutOffset: number = cluster.length - 1,
): string {
  const prefixLength = Math.max(0, boundary - cutOffset);
  return `${'a'.repeat(prefixLength)}${cluster}${'b'.repeat(tailLength)}`;
}

/**
 * Mirror of `buildBoundaryStraddlingText` for truncation that keeps the
 * *tail* of a string (`truncateGraphemesFromEnd`-style): positions `cluster`
 * so a naive `text.slice(-boundary)` lands partway into `cluster` from the
 * other side.
 *
 * `cutOffset` again counts UTF-16 code units, this time from `cluster`'s
 * *start*: the filler suffix is `boundary - cutOffset` code units, so the
 * naive slice keeps that many filler units plus the last `cutOffset` code
 * units of `cluster`. It defaults to `cluster.length - 1` — the naive cut
 * keeps every code unit of `cluster` *except the first* — for the same
 * reason as above: a conjunct's base consonant is dropped and its
 * virama/combining mark is left dangling at the front instead of the naive
 * cut quietly keeping just the (validly standalone) final consonant. Pass an
 * explicit `cutOffset` (e.g. `1`, the old default) to keep only the
 * cluster's last code unit instead.
 */
export function buildTailBoundaryStraddlingText(
  boundary: number,
  cluster: string,
  headLength = 40,
  cutOffset: number = cluster.length - 1,
): string {
  const suffixLength = Math.max(0, boundary - cutOffset);
  return `${'a'.repeat(headLength)}${cluster}${'b'.repeat(suffixLength)}`;
}

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= HIGH_SURROGATE_MIN && codeUnit <= HIGH_SURROGATE_MAX;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= LOW_SURROGATE_MIN && codeUnit <= LOW_SURROGATE_MAX;
}

/** True if `text` contains a high surrogate with no following low surrogate, or a low
 * surrogate with no preceding high surrogate — the mojibake a naive code-unit cut leaves. */
export function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (isHighSurrogate(codeUnit)) {
      const next = text.charCodeAt(index + 1);
      if (!isLowSurrogate(next)) return true;
      index += 1;
    } else if (isLowSurrogate(codeUnit)) {
      return true;
    }
  }
  return false;
}

const COMBINING_MARK_PATTERN = /\p{M}/u;

/** True if `text` opens with a combining mark (a base letter's diacritic left behind
 * without its base, or a virama/conjunct-joiner left behind without its consonant). */
export function hasDanglingLeadingCombiningMark(text: string): boolean {
  if (!text) return false;
  const leadCodePoint = Array.from(text)[0];
  return COMBINING_MARK_PATTERN.test(leadCodePoint);
}

/** True if `text` ends with a virama / subjoining-consonant marker with nothing joined
 * after it — the Brahmic/Southeast-Asian equivalent of a dangling combining mark. */
const TRAILING_VIRAMA_PATTERN =
  /[्্੍્୍்్್്්္្]$/u;

export function hasDanglingTrailingVirama(text: string): boolean {
  return TRAILING_VIRAMA_PATTERN.test(text);
}

/** Full grapheme-safety assertion for a truncated/merged string: no lone surrogate
 * anywhere, and no dangling combining mark or virama at either seam this helper can
 * introduce (start from a tail-truncation, end from a head-truncation). */
export function expectGraphemeSafe(text: string): void {
  expect(hasLoneSurrogate(text)).toBe(false);
  expect(hasDanglingLeadingCombiningMark(text)).toBe(false);
  expect(hasDanglingTrailingVirama(text)).toBe(false);
}

/**
 * Universal, shape-agnostic grapheme-safety oracle for keep-first-N
 * truncation: segments both `input` and `output` into extended grapheme
 * clusters with `segmentGraphemes` and requires `output`'s cluster sequence
 * to be *exactly* the first `segmentGraphemes(output).length` clusters of
 * `input`, joined back to a string. Unlike `expectGraphemeSafe`'s pattern
 * matches, this catches every mis-cut a naive code-unit slice can produce —
 * including a Devanagari conjunct truncated down to a lone (validly
 * standalone) base consonant, or an Arabic base letter with its combining
 * mark silently dropped — because either of those changes which clusters
 * `output` is built from, not just whether a dangling mark pattern matches.
 *
 * `output` must actually be a prefix of `input` in the ordinary string sense
 * too (`input.startsWith(output)`); the cluster-prefix check alone would
 * accept a same-content-different-order rearrangement, which no real
 * truncation call site produces but which would defeat the point of an
 * oracle if it slipped through.
 */
export function endsOnGraphemeBoundary(input: string, output: string): boolean {
  if (!input.startsWith(output)) return false;
  const inputClusters = segmentGraphemes(input);
  const outputClusterCount = segmentGraphemes(output).length;
  if (outputClusterCount > inputClusters.length) return false;
  return inputClusters.slice(0, outputClusterCount).join('') === output;
}

/**
 * Mirror of `endsOnGraphemeBoundary` for keep-last-N (tail) truncation:
 * requires `output`'s cluster sequence to be exactly the *last*
 * `segmentGraphemes(output).length` clusters of `input`, and that `output`
 * is an ordinary string suffix of `input`.
 */
export function startsOnGraphemeBoundary(input: string, output: string): boolean {
  if (!input.endsWith(output)) return false;
  const inputClusters = segmentGraphemes(input);
  const outputClusterCount = segmentGraphemes(output).length;
  if (outputClusterCount > inputClusters.length) return false;
  const tailStart = inputClusters.length - outputClusterCount;
  return inputClusters.slice(tailStart).join('') === output;
}
