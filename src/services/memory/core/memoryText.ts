// ---------------------------------------------------------------------------
// Kavi — Length of memory text
// ---------------------------------------------------------------------------
// Memory text is bounded in Unicode code points: the unit SQLite's length() counts in the
// table checks and the unit JSON Schema's maxLength counts in the tool schema, so the
// three layers agree on every script and emoji. A cut never splits a grapheme cluster.
// ---------------------------------------------------------------------------

import { snapIndexDownToGraphemeBoundary } from '../../../utils/graphemeBoundary';

const ELLIPSIS = '…';

export function memoryTextLength(text: string): number {
  let count = 0;
  for (const _codePoint of text) count += 1;
  return count;
}

function codeUnitOffsetAfter(text: string, codePoints: number): number {
  let offset = 0;
  let seen = 0;
  for (const codePoint of text) {
    if (seen === codePoints) break;
    offset += codePoint.length;
    seen += 1;
  }
  return offset;
}

/** `text` when it fits in `maxCodePoints`, else cut at a grapheme boundary and ended with "…". */
export function boundMemoryText(text: string, maxCodePoints: number): string {
  if (memoryTextLength(text) <= maxCodePoints) return text;
  const cut = snapIndexDownToGraphemeBoundary(
    text,
    codeUnitOffsetAfter(text, Math.max(0, maxCodePoints - memoryTextLength(ELLIPSIS))),
  );
  return `${text.slice(0, cut).trimEnd()}${ELLIPSIS}`;
}
