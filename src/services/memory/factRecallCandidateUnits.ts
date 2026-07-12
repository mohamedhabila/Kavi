const RECALL_INDEXED_QUERY_UNIT_LIMIT = 24;

function evenlySampleUnits(units: readonly string[], count: number): string[] {
  if (count <= 0 || units.length === 0) return [];
  if (count >= units.length) return [...units];
  if (count === 1) return [units.at(-1)!];
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round((index * (units.length - 1)) / (count - 1));
    return units[sourceIndex]!;
  });
}

export function selectIndexedRecallLexicalUnits(
  recallLexicalUnits: ReadonlyArray<string>,
  anchorLexicalUnits: ReadonlyArray<string>,
): string[] {
  const units = Array.from(new Set(recallLexicalUnits));
  if (units.length <= RECALL_INDEXED_QUERY_UNIT_LIMIT) return units;
  const anchorUnits = new Set(anchorLexicalUnits);
  const anchors = units.filter((unit) => anchorUnits.has(unit));
  if (anchors.length >= RECALL_INDEXED_QUERY_UNIT_LIMIT) {
    return evenlySampleUnits(anchors, RECALL_INDEXED_QUERY_UNIT_LIMIT);
  }
  const nonAnchors = units.filter((unit) => !anchorUnits.has(unit));
  return [
    ...anchors,
    ...evenlySampleUnits(nonAnchors, RECALL_INDEXED_QUERY_UNIT_LIMIT - anchors.length),
  ];
}
