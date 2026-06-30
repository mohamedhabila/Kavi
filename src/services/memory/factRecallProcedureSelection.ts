import type { RecallFactsOptions, ScoredFact } from './factRecallTypes';

function isProcedureOnlyRecall(options: RecallFactsOptions): boolean {
  const memoryKind = options.memoryKind;
  return (
    memoryKind === 'procedure' ||
    (Array.isArray(memoryKind) && memoryKind.length === 1 && memoryKind[0] === 'procedure')
  );
}

export function primaryProcedureSlotLimit(
  primaryLimit: number,
  options: RecallFactsOptions,
): number {
  if (isProcedureOnlyRecall(options)) return primaryLimit;
  return Math.max(1, Math.floor(primaryLimit * 0.25));
}

function compareProcedureRelevance(left: ScoredFact, right: ScoredFact): number {
  if (right.relevanceScore !== left.relevanceScore) {
    return right.relevanceScore - left.relevanceScore;
  }
  if (right.quotedUiControlBoost !== left.quotedUiControlBoost) {
    return right.quotedUiControlBoost - left.quotedUiControlBoost;
  }
  if (right.score !== left.score) return right.score - left.score;
  return right.fact.updatedAt - left.fact.updatedAt;
}

export function bestStandaloneProcedureCandidate(
  scored: ReadonlyArray<ScoredFact>,
  threshold: number,
  isCompatible: (entry: ScoredFact) => boolean,
): ScoredFact | undefined {
  return scored
    .filter(
      (entry) =>
        entry.fact.memoryKind === 'procedure' &&
        entry.fact.sourceRunId &&
        (entry.relevanceScore >= threshold || entry.score >= threshold) &&
        isCompatible(entry),
    )
    .sort(compareProcedureRelevance)[0];
}
