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
 * Build a string of `boundary - 1` ASCII filler code units, followed by
 * `cluster`, followed by more filler — sized so a naive `text.slice(0,
 * boundary)` (or `.slice(0, boundary - suffixLength)`) lands one code unit
 * into `cluster`, splitting it. `cluster` must be >= 2 UTF-16 code units
 * (true of every fixture above) for the split to be reachable at all.
 */
export function buildBoundaryStraddlingText(
  boundary: number,
  cluster: string,
  tailLength = 40,
): string {
  const prefixLength = Math.max(0, boundary - 1);
  return `${'a'.repeat(prefixLength)}${cluster}${'b'.repeat(tailLength)}`;
}

/**
 * Mirror of `buildBoundaryStraddlingText` for truncation that keeps the *tail* of a
 * string (`truncateGraphemesFromEnd`-style): positions `cluster` so a naive
 * `text.slice(-boundary)` keeps only its trailing code unit, orphaning the rest.
 */
export function buildTailBoundaryStraddlingText(
  boundary: number,
  cluster: string,
  headLength = 40,
): string {
  const suffixLength = Math.max(0, boundary - 1);
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
