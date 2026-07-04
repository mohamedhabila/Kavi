export interface OrderedEvidenceIndexInput {
  itemCount: number;
  maxItems: number;
  matchIndexes?: ReadonlyArray<number>;
  windowRadius?: number;
}

export function selectOrderedEvidenceIndexes(input: OrderedEvidenceIndexInput): number[] {
  const itemCount = Math.max(0, Math.floor(input.itemCount));
  const maxItems = Math.max(0, Math.floor(input.maxItems));
  if (itemCount === 0 || maxItems === 0) return [];
  if (itemCount <= maxItems) return Array.from({ length: itemCount }, (_entry, index) => index);

  const selected = new Set<number>();
  const appendIndex = (index: number): boolean => {
    if (selected.size >= maxItems || index < 0 || index >= itemCount) return false;
    selected.add(index);
    return selected.size < maxItems;
  };

  appendIndex(0);
  appendIndex(itemCount - 1);

  const matchIndexes = input.matchIndexes ?? [];
  const windowRadius = Math.max(0, Math.floor(input.windowRadius ?? 0));
  if (matchIndexes.length > 0) {
    for (const matchIndex of matchIndexes) {
      for (
        let index = Math.max(0, matchIndex - windowRadius);
        index <= Math.min(itemCount - 1, matchIndex + windowRadius);
        index += 1
      ) {
        if (!appendIndex(index)) break;
      }
      if (selected.size >= maxItems) break;
    }
  } else {
    for (let index = 1; index < itemCount - 1; index += 1) {
      if (!appendIndex(index)) break;
    }
  }

  return Array.from(selected).sort((left, right) => left - right);
}
