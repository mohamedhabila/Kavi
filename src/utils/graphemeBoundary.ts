// ---------------------------------------------------------------------------
// Kavi — Grapheme-boundary helpers for text truncation and stitching
// ---------------------------------------------------------------------------
// `src/utils/graphemes.ts` exposes grapheme-COUNT based truncation
// (`truncateGraphemesTo` / `truncateGraphemesFromEnd`), which is exactly what
// most previews in this codebase need: "keep the first/last N user-perceived
// characters". A few shapes of call site aren't covered by that API and
// can't be, without changing what `maxLength` means there:
//
//   1. An "cut and mark with an ellipsis" preview — reserve room for a fixed
//      suffix (`...`, `…`) and cut the rest to a HARD grapheme-count limit.
//      This must be an exact cut, not `truncateGraphemesTo`'s boundary-
//      preferring one: a caller reserving room for a suffix already picked
//      the exact total length it wants, and searching backwards for a
//      sentence/whitespace boundary on top of that reservation can silently
//      drop far more than intended (up to `boundarySearchWindow` additional
//      graphemes) since the "nicer" cut point is doing double duty as an
//      already-tight budget. `truncateGraphemesWithSuffix` fills the
//      available budget exactly instead.
//   2. A numeric INDEX computed by other means (`indexOf`, a match offset, a
//      newline search) that must land on a grapheme boundary. Passing such
//      an index as a grapheme *count* to `truncateGraphemesTo` would silently
//      change what gets kept whenever the text has any multi-code-unit
//      grapheme before that index. `snapIndexDownToGraphemeBoundary` /
//      `snapIndexUpToGraphemeBoundary` instead keep the same code-unit index
//      space and only nudge it to the nearest safe boundary.
//
// Both are implemented on top of `segmentGraphemes`, the one primitive
// `graphemes.ts` already exports for this. See the module doc there for why
// grapheme clusters (not codepoints) are the right unit.

import { segmentGraphemes, truncateGraphemesTo } from './graphemes';

/** No boundary search: fill graphemes up to the hard limit exactly. Used by
 * `truncateGraphemesWithSuffix`, where the caller already reserved room for
 * a fixed suffix and a "nicer" boundary earlier in the text would silently
 * shrink that reservation further. */
const NO_BOUNDARY_SEARCH = { boundarySearchWindow: 0 } as const;

/**
 * Truncate `text` to at most `maxLength` graphemes and append `suffix`
 * (an indicator like `...` or `…`), reserving room for the suffix so the
 * whole result — cut text plus suffix — never exceeds `maxLength` graphemes.
 * Returns `text` unchanged when it already fits. This is the repeated
 * "cut and mark with an ellipsis" shape used across preview truncation in
 * this codebase, now grapheme-safe.
 *
 * The cut lands exactly at the available budget (no sentence/whitespace
 * boundary preference): the suffix already signals that text was cut, and a
 * caller reserving exact room for it expects the full remaining budget to be
 * used, not shrunk further by a "nicer" boundary found earlier in the text.
 */
export function truncateGraphemesWithSuffix(
  text: string,
  maxLength: number,
  suffix: string,
): string {
  if (segmentGraphemes(text).length <= maxLength) return text;
  const available = Math.max(0, maxLength - segmentGraphemes(suffix).length);
  return `${truncateGraphemesTo(text, available, NO_BOUNDARY_SEARCH).trimEnd()}${suffix}`;
}

function graphemeBoundaryOffsets(text: string): number[] {
  const offsets: number[] = [0];
  let cursor = 0;
  for (const grapheme of segmentGraphemes(text)) {
    cursor += grapheme.length;
    offsets.push(cursor);
  }
  return offsets;
}

/**
 * Nearest grapheme-cluster boundary in `text` at or before the code-unit
 * `index`. Clamped to `[0, text.length]`. Use this to fix up an index found
 * by `indexOf`/`search`/arithmetic before slicing with it, instead of
 * treating that index as a grapheme count.
 */
export function snapIndexDownToGraphemeBoundary(text: string, index: number): number {
  const clamped = Math.max(0, Math.min(index, text.length));
  if (clamped === 0 || clamped === text.length) return clamped;

  let boundary = 0;
  for (const offset of graphemeBoundaryOffsets(text)) {
    if (offset > clamped) break;
    boundary = offset;
  }
  return boundary;
}

/**
 * Nearest grapheme-cluster boundary in `text` at or after the code-unit
 * `index`. Clamped to `[0, text.length]`. Use this when the kept region
 * starts at `index` (e.g. a tail slice), so the kept text never opens with a
 * stray low surrogate or combining mark left over from a split cluster.
 */
export function snapIndexUpToGraphemeBoundary(text: string, index: number): number {
  const clamped = Math.max(0, Math.min(index, text.length));
  if (clamped === 0 || clamped === text.length) return clamped;

  for (const offset of graphemeBoundaryOffsets(text)) {
    if (offset >= clamped) return offset;
  }
  return text.length;
}

/**
 * Longest suffix-of-`existingText`/prefix-of-`incomingText` overlap, measured
 * so that slicing `incomingText` at the returned length can never split a
 * grapheme cluster of `incomingText`. Used to stitch two overlapping chunks
 * of streamed/replayed assistant text back together (`existingText +
 * incomingText.slice(overlapLength)`) without producing a lone surrogate or
 * an orphaned combining mark at the seam.
 *
 * Only `incomingText`'s own boundaries matter here: the equality check below
 * compares raw code-unit slices (exact comparison is correct regardless of
 * where either slice happens to land), but the *kept* output only ever
 * slices `incomingText`, so only that side needs boundary-safe candidates.
 */
export function findGraphemeSafeOverlapLength(existingText: string, incomingText: string): number {
  const maxOverlap = Math.min(existingText.length, incomingText.length);
  if (maxOverlap === 0) return 0;

  const candidates: number[] = [];
  let cursor = 0;
  for (const grapheme of segmentGraphemes(incomingText)) {
    cursor += grapheme.length;
    if (cursor > maxOverlap) break;
    candidates.push(cursor);
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const overlapLength = candidates[i];
    if (existingText.slice(-overlapLength) === incomingText.slice(0, overlapLength)) {
      return overlapLength;
    }
  }

  return 0;
}
