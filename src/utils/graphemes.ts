// ---------------------------------------------------------------------------
// Kavi — Grapheme-safe text utilities
// ---------------------------------------------------------------------------
// Cutting a string at an arbitrary character index can split a UTF-16
// surrogate pair, an emoji ZWJ sequence, a Devanagari/Indic consonant
// conjunct, or a base letter from its combining diacritic — producing
// mojibake or an orphaned low surrogate. `segmentGraphemes` splits text into
// user-perceived characters (extended grapheme clusters) instead, and
// `truncateGraphemesTo` / `truncateGraphemesFromEnd` cut only at cluster
// boundaries, preferring a sentence or whitespace boundary nearby.
//
// `Intl.Segmenter` (ICU-backed) does this correctly out of the box, including
// the Unicode 15 "Indic Conjunct Break" rules that keep a virama-joined
// consonant cluster together. Hermes does not implement `Intl.Segmenter`, so
// this module falls back to a hand-rolled cluster scan that covers the cases
// this codebase actually needs to protect: surrogate pairs (via codepoint
// iteration), emoji ZWJ sequences, regional-indicator flag pairs, combining
// marks, and Brahmic/Southeast-Asian virama-style conjuncts. The fallback is
// intentionally not a full UAX #29 implementation.

type GraphemeSegment = { segment: string };
type GraphemeSegmenterLike = { segment(input: string): Iterable<GraphemeSegment> };
type GraphemeSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: 'grapheme' },
) => GraphemeSegmenterLike;

let cachedGraphemeSegmenter: GraphemeSegmenterLike | null | undefined;

function getGraphemeSegmenter(): GraphemeSegmenterLike | null {
  if (cachedGraphemeSegmenter !== undefined) return cachedGraphemeSegmenter;
  const segmenterCtor = (
    Intl as typeof Intl & { Segmenter?: GraphemeSegmenterConstructor }
  ).Segmenter;
  cachedGraphemeSegmenter =
    typeof segmenterCtor === 'function'
      ? new segmenterCtor(undefined, { granularity: 'grapheme' })
      : null;
  return cachedGraphemeSegmenter;
}

/** Test-only: forces re-detection of `Intl.Segmenter` on the next call, so a
 * test can delete/restore the constructor and exercise both code paths. */
export function resetGraphemeSegmenterCacheForTests(): void {
  cachedGraphemeSegmenter = undefined;
}

const ZERO_WIDTH_JOINER = '‍';
const COMBINING_MARK_PATTERN = /\p{M}/u;
const REGIONAL_INDICATOR_PATTERN = /\p{Regional_Indicator}/u;

/**
 * Virama / subjoining-consonant markers across the Brahmic and Southeast
 * Asian scripts this codebase classifies (see `tokenCounter.ts`'s
 * devanagariIndic and thaiLaoKhmerMyanmar buckets). A virama after a
 * consonant signals that the *next* codepoint — mark or base letter — is
 * still part of the same conjunct, e.g. Devanagari "क" + "्" + "ष" = the
 * single akshara "क्ष". This is a fixed Unicode code-point table, not a
 * language- or keyword-based heuristic.
 */
const INDIC_VIRAMA_CODE_POINTS = new Set<string>([
  '्', // Devanagari virama
  '্', // Bengali virama
  '੍', // Gurmukhi virama
  '્', // Gujarati virama
  '୍', // Oriya virama
  '்', // Tamil virama
  '్', // Telugu virama
  '್', // Kannada virama
  '്', // Malayalam virama
  '්', // Sinhala al-lakuna
  '္', // Myanmar virama
  '្', // Khmer coeng
]);

function segmentGraphemesFallback(text: string): string[] {
  const clusters: string[] = [];
  let current = '';
  let pendingZwjJoin = false;
  let pendingConjunctJoin = false;
  let lastWasRegionalIndicator = false;

  const startCluster = (codePoint: string): void => {
    current = codePoint;
    pendingZwjJoin = false;
    pendingConjunctJoin = INDIC_VIRAMA_CODE_POINTS.has(codePoint);
    lastWasRegionalIndicator = REGIONAL_INDICATOR_PATTERN.test(codePoint);
  };

  // `for...of` over a string iterates by codepoint, so surrogate pairs are
  // always kept together — this loop can never split one.
  for (const codePoint of text) {
    if (current === '') {
      startCluster(codePoint);
      continue;
    }

    if (pendingZwjJoin) {
      current += codePoint;
      pendingZwjJoin = codePoint === ZERO_WIDTH_JOINER;
      pendingConjunctJoin = INDIC_VIRAMA_CODE_POINTS.has(codePoint);
      lastWasRegionalIndicator = false;
      continue;
    }

    if (pendingConjunctJoin) {
      current += codePoint;
      pendingConjunctJoin = INDIC_VIRAMA_CODE_POINTS.has(codePoint);
      pendingZwjJoin = codePoint === ZERO_WIDTH_JOINER;
      lastWasRegionalIndicator = false;
      continue;
    }

    if (COMBINING_MARK_PATTERN.test(codePoint)) {
      current += codePoint;
      pendingConjunctJoin = INDIC_VIRAMA_CODE_POINTS.has(codePoint);
      continue;
    }

    if (codePoint === ZERO_WIDTH_JOINER) {
      current += codePoint;
      pendingZwjJoin = true;
      continue;
    }

    if (
      lastWasRegionalIndicator &&
      REGIONAL_INDICATOR_PATTERN.test(codePoint) &&
      Array.from(current).length === 1
    ) {
      // A flag emoji is exactly a pair of regional indicators; reset so a
      // third/fourth indicator starts a new (potential) flag pair.
      current += codePoint;
      lastWasRegionalIndicator = false;
      continue;
    }

    clusters.push(current);
    startCluster(codePoint);
  }

  if (current !== '') clusters.push(current);
  return clusters;
}

/** Split `text` into extended grapheme clusters (user-perceived characters). */
export function segmentGraphemes(text: string): string[] {
  if (!text) return [];
  const segmenter = getGraphemeSegmenter();
  if (segmenter) {
    return Array.from(segmenter.segment(text), (part) => part.segment);
  }
  return segmentGraphemesFallback(text);
}

// ── Boundary-preferring, grapheme-safe truncation ───────────────────────────

const FALLBACK_SENTENCE_TERMINALS = new Set(['.', '。', '؟', '।', '!', '?']);

function buildSentenceTerminalPattern(): RegExp | null {
  try {
    return new RegExp('\\p{Sentence_Terminal}', 'u');
  } catch {
    return null;
  }
}

/** `\p{Sentence_Terminal}` needs Unicode-property regex support; not every
 * runtime this app ships on guarantees it, so this is built once, guarded. */
const SENTENCE_TERMINAL_PATTERN = buildSentenceTerminalPattern();

function isSentenceTerminalGrapheme(grapheme: string): boolean {
  const leadCodePoint = Array.from(grapheme)[0] ?? grapheme;
  if (SENTENCE_TERMINAL_PATTERN) return SENTENCE_TERMINAL_PATTERN.test(leadCodePoint);
  return FALLBACK_SENTENCE_TERMINALS.has(leadCodePoint);
}

const WHITESPACE_PATTERN = /\s/u;

export interface GraphemeSafeTruncateOptions {
  /** How many graphemes back from the hard cut to search for a nicer boundary. */
  boundarySearchWindow?: number;
}

const DEFAULT_BOUNDARY_SEARCH_WINDOW = 80;

/**
 * Truncate `text` to at most `maxLength` graphemes, keeping the beginning.
 * Never splits a grapheme cluster. Within `boundarySearchWindow` graphemes of
 * the hard limit, prefers to end at a sentence terminator, then at
 * whitespace; otherwise cuts exactly at `maxLength` graphemes.
 */
export function truncateGraphemesTo(
  text: string,
  maxLength: number,
  options?: GraphemeSafeTruncateOptions,
): string {
  if (maxLength <= 0) return '';
  const graphemes = segmentGraphemes(text);
  if (graphemes.length <= maxLength) return text;

  const window = Math.max(0, options?.boundarySearchWindow ?? DEFAULT_BOUNDARY_SEARCH_WINDOW);
  const hardCutIndex = maxLength;
  const searchFloor = Math.max(0, hardCutIndex - window);

  for (let index = hardCutIndex - 1; index >= searchFloor; index -= 1) {
    if (isSentenceTerminalGrapheme(graphemes[index])) {
      return graphemes.slice(0, index + 1).join('');
    }
  }

  for (let index = hardCutIndex - 1; index >= searchFloor; index -= 1) {
    if (WHITESPACE_PATTERN.test(graphemes[index])) {
      return graphemes.slice(0, index).join('');
    }
  }

  return graphemes.slice(0, hardCutIndex).join('');
}

/**
 * Truncate `text` to at most `maxLength` graphemes, keeping the end. Never
 * splits a grapheme cluster. Within `boundarySearchWindow` graphemes of the
 * hard start, prefers to begin right after a whitespace boundary so the kept
 * tail doesn't open mid-word; otherwise cuts exactly at `maxLength` graphemes.
 */
export function truncateGraphemesFromEnd(
  text: string,
  maxLength: number,
  options?: GraphemeSafeTruncateOptions,
): string {
  if (maxLength <= 0) return '';
  const graphemes = segmentGraphemes(text);
  if (graphemes.length <= maxLength) return text;

  const window = Math.max(0, options?.boundarySearchWindow ?? DEFAULT_BOUNDARY_SEARCH_WINDOW);
  const hardStartIndex = graphemes.length - maxLength;
  const searchCeiling = Math.min(graphemes.length - 1, hardStartIndex + window);

  for (let index = hardStartIndex; index <= searchCeiling; index += 1) {
    if (WHITESPACE_PATTERN.test(graphemes[index])) {
      return graphemes.slice(index + 1).join('');
    }
  }

  return graphemes.slice(hardStartIndex).join('');
}

/** Number of extended grapheme clusters in `text` (user-perceived length). */
export function graphemeLength(text: string): number {
  return segmentGraphemes(text).length;
}
