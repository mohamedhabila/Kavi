const RECALL_QUERY_UNIT_LIMIT = 96;

export function buildRecallLexicalUnits(
  queryUnitCounts: ReadonlyMap<string, number>,
  anchorLexicalUnits: ReadonlyArray<string>,
  lexicalUnitLimit: number | undefined,
): string[] {
  const limit = Math.max(
    1,
    Math.min(lexicalUnitLimit ?? RECALL_QUERY_UNIT_LIMIT, RECALL_QUERY_UNIT_LIMIT),
  );
  const units: string[] = [];
  const seen = new Set<string>();
  const addUnit = (rawUnit: string) => {
    if (units.length >= limit) return;
    const unit = rawUnit.trim();
    if (!unit || seen.has(unit)) return;
    seen.add(unit);
    units.push(unit);
  };

  for (const unit of anchorLexicalUnits) addUnit(unit);
  for (const unit of queryUnitCounts.keys()) addUnit(unit);
  return units;
}

export function selectScoringQueryUnits(
  recallLexicalUnits: ReadonlyArray<string>,
  queryUnits: ReadonlySet<string>,
  candidateUnitHits: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const hitUnits = new Set<string>();
  for (const hits of candidateUnitHits.values()) {
    for (const unit of hits) hitUnits.add(unit);
  }
  const scoringUnits = new Set<string>();
  for (const unit of recallLexicalUnits) {
    if (queryUnits.has(unit) && hitUnits.has(unit)) scoringUnits.add(unit);
  }
  if (scoringUnits.size > 0) return scoringUnits;
  for (const unit of recallLexicalUnits) {
    if (queryUnits.has(unit)) scoringUnits.add(unit);
  }
  return scoringUnits;
}
