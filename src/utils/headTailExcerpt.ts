import {
  exceedsGraphemeLength,
  graphemeLength,
  truncateGraphemesFromEnd,
  truncateGraphemesTo,
} from './graphemes';

/** Share of the available budget kept from the head; the remainder goes to the tail. */
const HEAD_SHARE = 0.65;

/**
 * Keep the head and tail of `value`, dropping the middle, so the result fits
 * within `maxChars` graphemes. Never splits a grapheme cluster.
 */
export function buildHeadTailExcerpt(value: string, maxChars: number): string {
  // Cheap early exit before paying for the exact count this hot path only
  // needs when truncation is actually going to happen.
  if (!exceedsGraphemeLength(value, maxChars)) {
    return value;
  }
  const totalGraphemes = graphemeLength(value);

  const notice = `\n... [truncated ${totalGraphemes - maxChars} chars] ...\n`;
  const available = Math.max(0, maxChars - graphemeLength(notice));
  const headChars = Math.max(0, Math.floor(available * HEAD_SHARE));
  const tailChars = Math.max(0, available - headChars);
  return `${truncateGraphemesTo(value, headChars)}${notice}${truncateGraphemesFromEnd(value, tailChars)}`;
}
