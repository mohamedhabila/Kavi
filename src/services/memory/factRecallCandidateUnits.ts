import { listFactTermStatsForUnits } from './facts/queries';

const RECALL_INDEXED_QUERY_UNIT_LIMIT = 36;
const RECALL_INDEXED_QUERY_UNIT_MIN = 8;

export function selectIndexedRecallLexicalUnits(
  recallLexicalUnits: ReadonlyArray<string>,
  anchorLexicalUnits: ReadonlyArray<string>,
): string[] {
  if (recallLexicalUnits.length <= RECALL_INDEXED_QUERY_UNIT_LIMIT) {
    return [...recallLexicalUnits];
  }
  const unitStats = listFactTermStatsForUnits(recallLexicalUnits);
  const originalRank = new Map(recallLexicalUnits.map((unit, index) => [unit, index]));
  const anchorUnits = new Set(anchorLexicalUnits);
  const ranked = [...recallLexicalUnits].sort((left, right) => {
    const anchorDiff = Number(anchorUnits.has(right)) - Number(anchorUnits.has(left));
    if (anchorDiff !== 0) return anchorDiff;
    const leftKnown = unitStats.has(left);
    const rightKnown = unitStats.has(right);
    if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
    const leftCount = unitStats.get(left)?.factCount ?? Number.MAX_SAFE_INTEGER;
    const rightCount = unitStats.get(right)?.factCount ?? Number.MAX_SAFE_INTEGER;
    if (leftCount !== rightCount) return leftCount - rightCount;
    return (originalRank.get(left) ?? 0) - (originalRank.get(right) ?? 0);
  });
  return ranked.slice(
    0,
    Math.max(
      RECALL_INDEXED_QUERY_UNIT_MIN,
      Math.min(RECALL_INDEXED_QUERY_UNIT_LIMIT, recallLexicalUnits.length),
    ),
  );
}
