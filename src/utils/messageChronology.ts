import type { Message } from '../types/message';

/** Merge two chronological message lists, keeping each list's own order on equal times. */
export function mergeChronologically(
  older: ReadonlyArray<Message>,
  newer: ReadonlyArray<Message>,
): Message[] {
  if (older.length === 0) return [...newer];
  if (newer.length === 0) return [...older];
  const merged: Message[] = [];
  let olderIndex = 0;
  let newerIndex = 0;
  while (olderIndex < older.length && newerIndex < newer.length) {
    if ((older[olderIndex]!.timestamp ?? 0) <= (newer[newerIndex]!.timestamp ?? 0)) {
      merged.push(older[olderIndex]!);
      olderIndex += 1;
    } else {
      merged.push(newer[newerIndex]!);
      newerIndex += 1;
    }
  }
  return merged.concat(older.slice(olderIndex), newer.slice(newerIndex));
}
