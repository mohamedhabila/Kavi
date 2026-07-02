import { listFactTermUnitHitsForFacts, listFactsForSourceRunForwardWindows } from './facts/queries';
import type { MemoryFact, MemoryFactScope } from './facts/types';
import { buildScoredFact } from './factRecallScoring';
import type { RecallFactsOptions, ScoredFact } from './factRecallTypes';
import { isActionResultOutcome } from './factRecallSupport';

const ACTION_RESULT_PROMOTION_FORWARD_RADIUS = 1;
const ACTION_RESULT_PROMOTION_STATE_LIMIT = 1;
const ACTION_RESULT_PROMOTION_MAX_HOPS = 2;

function actionContinuationReplacementIndex(
  selected: ReadonlyArray<MemoryFact>,
  scoredById: ReadonlyMap<string, ScoredFact>,
  sourceRunId: string | null | undefined,
): number {
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  selected.forEach((fact, index) => {
    if (fact.pinned || fact.memoryKind === 'procedure' || isActionResultOutcome(fact)) return;
    if (!fact.sourceRunId || fact.sourceRunId !== sourceRunId) return;
    const score = scoredById.get(fact.id)?.score ?? 0;
    if (score < bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex;
}

function stateIndexContextValue(fact: MemoryFact): string | number | null {
  const value = fact.attributes.stateIndex;
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

export function promoteSelectedActionResultContinuations(params: {
  selected: MemoryFact[];
  seenIds: Set<string>;
  scoredById: Map<string, ScoredFact>;
  limit: number;
  threshold: number;
  candidateScopes: MemoryFactScope[] | undefined;
  options: RecallFactsOptions;
  scoringQueryUnits: ReadonlySet<string>;
  recallLexicalUnits: ReadonlyArray<string>;
  unitWeights: ReadonlyMap<string, number>;
  query: string;
  anchorUnitSets: ReadonlyArray<Set<string>>;
  alwaysIncludePinned: boolean;
  now: number;
}): void {
  const selectedIds = new Set(params.selected.map((fact) => fact.id));
  const actionAnchors = params.selected.filter(isActionResultOutcome);
  const commonQueryOptions = {
    ...(params.candidateScopes ? { scope: params.candidateScopes } : {}),
    ...(params.options.conversationId
      ? { originConversationId: params.options.conversationId }
      : {}),
    ...(params.options.taskId ? { originTaskId: params.options.taskId } : {}),
    ...(params.options.includeHistorical ? { includeInvalidated: true as const } : {}),
    ...(params.options.asOf !== undefined ? { asOf: params.options.asOf } : {}),
  };
  for (const actionAnchor of actionAnchors) {
    let anchor = actionAnchor;
    let hops = 0;
    while (params.selected.length <= params.limit && hops < ACTION_RESULT_PROMOTION_MAX_HOPS) {
      const stateIndex = stateIndexContextValue(anchor);
      if (stateIndex === null) break;
      const nextOutcome = listFactsForSourceRunForwardWindows(
        [{ sourceRunId: anchor.sourceRunId, stateIndex }],
        {
          memoryKind: ['outcome'],
          forwardRadius: ACTION_RESULT_PROMOTION_FORWARD_RADIUS,
          stateLimit: ACTION_RESULT_PROMOTION_STATE_LIMIT,
          factsPerStateKind: 4,
          limit: 4,
          ...commonQueryOptions,
        },
      ).find((fact) => isActionResultOutcome(fact) && !selectedIds.has(fact.id));
      if (!nextOutcome) break;
      const supportUnitHits = listFactTermUnitHitsForFacts(
        [nextOutcome.id],
        params.recallLexicalUnits,
      );
      const scored = buildScoredFact({
        fact: nextOutcome,
        queryUnits: params.scoringQueryUnits,
        factUnitHits: supportUnitHits.get(nextOutcome.id),
        unitWeights: params.unitWeights,
        query: params.query,
        anchorUnitSets: params.anchorUnitSets,
        alwaysIncludePinned: params.alwaysIncludePinned,
        options: params.options,
        now: params.now,
      });
      if (scored.relevanceScore < params.threshold && scored.score < params.threshold) break;
      if (params.selected.length < params.limit) {
        params.selected.push(nextOutcome);
      } else {
        const replacementIndex = actionContinuationReplacementIndex(
          params.selected,
          params.scoredById,
          nextOutcome.sourceRunId,
        );
        if (replacementIndex < 0) break;
        selectedIds.delete(params.selected[replacementIndex].id);
        params.selected[replacementIndex] = nextOutcome;
      }
      selectedIds.add(nextOutcome.id);
      params.seenIds.add(nextOutcome.id);
      params.scoredById.set(nextOutcome.id, scored);
      anchor = nextOutcome;
      hops += 1;
    }
  }
}
