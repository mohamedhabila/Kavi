const SCORING_LEXICAL_UNIT_LIMIT = 96;

export function buildScoringLexicalUnits(
  queryUnits: ReadonlySet<string>,
  selectedLexicalUnits: ReadonlyArray<string>,
): Set<string> {
  const scoringUnits = new Set<string>();
  for (const unit of selectedLexicalUnits) {
    if (scoringUnits.size >= SCORING_LEXICAL_UNIT_LIMIT) return scoringUnits;
    if (queryUnits.has(unit)) scoringUnits.add(unit);
  }
  if (scoringUnits.size > 0) return scoringUnits;
  for (const unit of queryUnits) {
    if (scoringUnits.size >= SCORING_LEXICAL_UNIT_LIMIT) break;
    scoringUnits.add(unit);
  }
  return scoringUnits;
}
