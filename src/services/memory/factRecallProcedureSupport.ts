import { listFactTermUnitHitsForFacts, listFactsForSourceRuns } from './facts/queries';
import type { MemoryFact, MemoryFactScope } from './facts/types';
import { buildScoredFact } from './factRecallScoring';
import type { RecallFactsOptions, ScoredFact } from './factRecallTypes';
import { compareSupportCandidates } from './ranking/selection';
import { isActionResultOutcome } from './factRecallSupport';

type ProcedureSupportOverflowPolicy = 'default' | 'replace_unrelated_context';

export function insertProcedureLocalSupport(params: {
  selected: MemoryFact[];
  seenIds: Set<string>;
  seenKeys: Set<string>;
  scoredById: Map<string, ScoredFact>;
  scored: ReadonlyArray<ScoredFact>;
  limit: number;
  procedureSupportBudget: number;
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
  if (params.procedureSupportBudget <= 0 || params.selected.length === 0) return;
  insertSelectedProcedureSupportForAnchors({
    params,
    budget: params.procedureSupportBudget,
    canAnchor: isActionResultOutcome,
    seenKeyPrefix: 'outcome_procedure_support',
  });
}

function removeOverflowFact(params: {
  selected: MemoryFact[];
  seenIds: Set<string>;
  insertedIndex: number;
  limit: number;
  policy: ProcedureSupportOverflowPolicy;
  protectedSourceRunId?: string;
}): boolean {
  if (params.selected.length <= params.limit) return true;
  const removeIndex = overflowRemovalIndex(params);
  if (removeIndex < 0) {
    const [inserted] = params.selected.splice(params.insertedIndex, 1);
    if (inserted) params.seenIds.delete(inserted.id);
    return false;
  }
  const [removed] = params.selected.splice(removeIndex, 1);
  if (removed) params.seenIds.delete(removed.id);
  return true;
}

function overflowRemovalIndex(params: {
  selected: MemoryFact[];
  insertedIndex: number;
  policy: ProcedureSupportOverflowPolicy;
  protectedSourceRunId?: string;
}): number {
  if (params.policy === 'replace_unrelated_context') {
    for (let index = params.selected.length - 1; index >= 0; index -= 1) {
      if (index === params.insertedIndex) continue;
      const fact = params.selected[index];
      if (!fact?.sourceRunId || fact.sourceRunId !== params.protectedSourceRunId) return index;
    }
  }
  for (let index = params.selected.length - 1; index >= 0; index -= 1) {
    if (index !== params.insertedIndex) return index;
  }
  return -1;
}

function insertSupportAfterAnchor(params: {
  selected: MemoryFact[];
  seenIds: Set<string>;
  seenKeys: Set<string>;
  scoredById: Map<string, ScoredFact>;
  limit: number;
  anchorIndex: number;
  supportFact: MemoryFact;
  supportScore: ScoredFact;
  seenKey: string;
  overflowPolicy: ProcedureSupportOverflowPolicy;
  protectedSourceRunId?: string;
}): boolean {
  const insertedIndex = Math.min(params.anchorIndex + 1, params.selected.length);
  params.selected.splice(insertedIndex, 0, params.supportFact);
  params.seenIds.add(params.supportFact.id);
  params.scoredById.set(params.supportFact.id, params.supportScore);
  const retained = removeOverflowFact({
    selected: params.selected,
    seenIds: params.seenIds,
    insertedIndex,
    limit: params.limit,
    policy: params.overflowPolicy,
    protectedSourceRunId: params.protectedSourceRunId,
  });
  if (!retained) {
    params.scoredById.delete(params.supportFact.id);
    return false;
  }
  params.seenKeys.add(params.seenKey);
  return true;
}

function insertSelectedProcedureSupportForAnchors(input: {
  params: Parameters<typeof insertProcedureLocalSupport>[0];
  budget: number;
  canAnchor: (fact: MemoryFact) => boolean;
  seenKeyPrefix: string;
}): void {
  const { params, budget, canAnchor, seenKeyPrefix } = input;
  const selectedProcedureSources = new Set(
    params.selected
      .filter((fact) => fact.memoryKind === 'procedure' && fact.sourceRunId)
      .map((fact) => fact.sourceRunId as string),
  );
  const anchors = params.selected
    .map((fact, index) => ({ fact, index }))
    .filter(
      (entry) =>
        canAnchor(entry.fact) &&
        entry.fact.sourceRunId &&
        !selectedProcedureSources.has(entry.fact.sourceRunId),
    )
    .sort((left, right) => {
      const leftScored = params.scoredById.get(left.fact.id);
      const rightScored = params.scoredById.get(right.fact.id);
      if (leftScored && rightScored) {
        return compareSupportCandidates(
          { fact: left.fact, scored: leftScored },
          { fact: right.fact, scored: rightScored },
        );
      }
      if (leftScored !== rightScored) return leftScored ? -1 : 1;
      return left.index - right.index;
    });
  if (anchors.length === 0) return;

  const sourceRunIds = Array.from(new Set(anchors.map((entry) => entry.fact.sourceRunId as string)));
  const procedureFacts = listFactsForSourceRuns(sourceRunIds, {
    memoryKind: 'procedure',
    limit: sourceRunIds.length * 2,
    ...(params.candidateScopes ? { scope: params.candidateScopes } : {}),
    ...(params.options.conversationId ? { originConversationId: params.options.conversationId } : {}),
    ...(params.options.taskId ? { originTaskId: params.options.taskId } : {}),
    ...(params.options.includeHistorical ? { includeInvalidated: true } : {}),
    ...(params.options.asOf !== undefined ? { asOf: params.options.asOf } : {}),
  }).filter((fact) => !params.seenIds.has(fact.id));
  if (procedureFacts.length === 0) return;

  const procedureUnitHits = listFactTermUnitHitsForFacts(
    procedureFacts.map((fact) => fact.id),
    params.recallLexicalUnits,
  );
  const proceduresBySource = new Map<string, Array<{ fact: MemoryFact; scored: ScoredFact }>>();
  for (const fact of procedureFacts) {
    if (!fact.sourceRunId) continue;
    const scored = buildScoredFact({
      fact,
      queryUnits: params.scoringQueryUnits,
      factUnitHits: procedureUnitHits.get(fact.id),
      unitWeights: params.unitWeights,
      query: params.query,
      anchorUnitSets: params.anchorUnitSets,
      alwaysIncludePinned: params.alwaysIncludePinned,
      options: params.options,
      now: params.now,
    });
    const list = proceduresBySource.get(fact.sourceRunId) ?? [];
    list.push({ fact, scored });
    proceduresBySource.set(fact.sourceRunId, list);
  }

  let inserted = 0;
  for (const anchor of anchors) {
    if (inserted >= budget) break;
    const candidates = proceduresBySource.get(anchor.fact.sourceRunId as string);
    if (!candidates?.length) continue;
    candidates.sort((left, right) => compareSupportCandidates(left, right));
    const support = candidates[0];
    const didInsert = insertSupportAfterAnchor({
      selected: params.selected,
      seenIds: params.seenIds,
      seenKeys: params.seenKeys,
      scoredById: params.scoredById,
      limit: params.limit,
      anchorIndex: anchor.index,
      supportFact: support.fact,
      supportScore: support.scored,
      seenKey: `${seenKeyPrefix}:${support.fact.id}`,
      overflowPolicy: 'replace_unrelated_context',
      protectedSourceRunId: anchor.fact.sourceRunId as string,
    });
    if (!didInsert) continue;
    selectedProcedureSources.add(anchor.fact.sourceRunId as string);
    inserted += 1;
  }
}
