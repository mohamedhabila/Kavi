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

/**
 * Lazily yields the fallback grapheme clusters of `text`, one at a time, so a
 * caller that only needs to answer a yes/no question (e.g. "does this exceed
 * N clusters?") can stop pulling as soon as it knows the answer instead of
 * scanning the rest of a potentially huge string.
 */
function* iterateGraphemesFallback(text: string): Generator<string, void, void> {
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

    yield current;
    startCluster(codePoint);
  }

  if (current !== '') yield current;
}

/**
 * Lazily yields the extended grapheme clusters of `text`, using
 * `Intl.Segmenter` when available and the hand-rolled fallback otherwise.
 * Both paths are generators, so a consumer can `break` out of a `for...of`
 * loop early without paying for the clusters it never looked at.
 */
function* iterateGraphemes(text: string): Generator<string, void, void> {
  if (!text) return;
  const segmenter = getGraphemeSegmenter();
  if (segmenter) {
    for (const part of segmenter.segment(text)) yield part.segment;
    return;
  }
  yield* iterateGraphemesFallback(text);
}

/** Split `text` into extended grapheme clusters (user-perceived characters). */
export function segmentGraphemes(text: string): string[] {
  return Array.from(iterateGraphemes(text));
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
  // A grapheme cluster is never shorter than one UTF-16 code unit, so if the
  // raw code-unit length already fits the limit, the (>=1 shorter) grapheme
  // count fits too — no need to pay for segmentation at all.
  if (text.length <= maxLength) return text;
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
  // Same fast path as `truncateGraphemesTo`: code-unit length is always >=
  // grapheme count, so fitting within it already proves no truncation needed.
  if (text.length <= maxLength) return text;
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

/**
 * Equivalent to `graphemeLength(text) > limit`, without the cost of counting
 * every cluster when the answer is already decidable from `text.length`.
 *
 * A grapheme cluster is always at least one UTF-16 code unit, so
 * `graphemeLength(text) <= text.length` holds for every string. That gives
 * two free exits with no segmentation at all:
 *  - `text.length <= limit` proves `graphemeLength(text) <= limit`, so the
 *    answer is `false` (covers `limit` being `+Infinity`, and non-negative
 *    limits on short-enough text).
 *  - an empty `text` has `graphemeLength(text) === 0`; once the first bullet
 *    has ruled out `0 <= limit`, `limit` must be negative, so `0 > limit`
 *    and the answer is `true`.
 *
 * `limit` being `NaN` is handled up front to match plain `>` semantics: any
 * comparison against `NaN` is `false`, so `graphemeLength(text) > NaN` is
 * always `false`, whatever `text` is.
 *
 * Otherwise this walks the grapheme iterator (the native `Intl.Segmenter`
 * iterator when available, the hand-rolled generator fallback otherwise) one
 * cluster at a time and stops the instant the running count exceeds `limit`
 * — at most `limit + 1` clusters are ever produced, never the whole string.
 */
export function exceedsGraphemeLength(text: string, limit: number): boolean {
  if (Number.isNaN(limit)) return false;
  if (text.length <= limit) return false;
  if (text.length === 0) return true;

  let count = 0;
  for (const _cluster of iterateGraphemes(text)) {
    count += 1;
    if (count > limit) return true;
  }
  return false;
}

/**
 * Truncate `text` to at most `maxUtf16Length` UTF-16 code units, keeping the
 * beginning, for callers bound by a hard code-unit/byte budget imposed by an
 * external system (a provider API limit, a DB column cap, a notification
 * payload cap) rather than a display-oriented character count. Unlike
 * `truncateGraphemesTo`, the budget is measured in code units so the result
 * satisfies that external limit exactly — but the cut still never splits a
 * grapheme cluster: the last cluster that would push the running code-unit
 * count over budget is dropped whole rather than cut in half.
 */
export function truncateToUtf16BudgetGraphemeSafe(text: string, maxUtf16Length: number): string {
  if (maxUtf16Length <= 0) return '';
  if (text.length <= maxUtf16Length) return text;

  const graphemes = segmentGraphemes(text);
  let usedUtf16Length = 0;
  let clusterCount = 0;
  for (const grapheme of graphemes) {
    const nextUtf16Length = usedUtf16Length + grapheme.length;
    if (nextUtf16Length > maxUtf16Length) break;
    usedUtf16Length = nextUtf16Length;
    clusterCount += 1;
  }
  return graphemes.slice(0, clusterCount).join('');
}
