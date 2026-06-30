import {
  listFactsForSourceRunForwardWindows,
  listFactsForSourceRuns,
  listFactTermUnitHitsForFacts,
} from './facts/queries';
import type { MemoryFact, MemoryFactScope } from './facts/types';
import { buildScoredFact } from './factRecallScoring';
import type { RecallFactsOptions, ScoredFact } from './factRecallTypes';
import {
  compareSupportCandidates,
  sourceRunStateKey,
  sourceRunSupportContexts,
} from './ranking/selection';
import { isActionResultOutcome, supportEvidenceRichness } from './factRecallSupport';

const SOURCE_RUN_SUPPORT_FORWARD_RADIUS = 16;
const SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT = 16;

export function insertProcedureLocalSupport(params: {
  selected: MemoryFact[];
  seenIds: Set<string>;
  seenKeys: Set<string>;
  scoredById: Map<string, ScoredFact>;
  scored: ReadonlyArray<ScoredFact>;
  limit: number;
  uiSupportBudget: number;
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
  if (
    params.uiSupportBudget <= 0 &&
    params.procedureSupportBudget <= 0 &&
    params.selected.length === 0
  ) {
    return;
  }
  insertSelectedActionProcedureSupport(params);
  insertProcedureUiSupport(params);
}

function removeOverflowFact(params: {
  selected: MemoryFact[];
  seenIds: Set<string>;
  insertedIndex: number;
  limit: number;
}): void {
  if (params.selected.length <= params.limit) return;
  let removeIndex = -1;
  for (let index = params.selected.length - 1; index >= 0; index -= 1) {
    if (index === params.insertedIndex) continue;
    if (params.selected[index].memoryKind === 'outcome') {
      removeIndex = index;
      break;
    }
  }
  if (removeIndex < 0) {
    for (let index = params.selected.length - 1; index >= 0; index -= 1) {
      if (index !== params.insertedIndex) {
        removeIndex = index;
        break;
      }
    }
  }
  if (removeIndex < 0) return;
  const [removed] = params.selected.splice(removeIndex, 1);
  if (removed) params.seenIds.delete(removed.id);
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
}): void {
  const insertedIndex = Math.min(params.anchorIndex + 1, params.selected.length);
  params.selected.splice(insertedIndex, 0, params.supportFact);
  params.seenIds.add(params.supportFact.id);
  params.seenKeys.add(params.seenKey);
  params.scoredById.set(params.supportFact.id, params.supportScore);
  removeOverflowFact({
    selected: params.selected,
    seenIds: params.seenIds,
    insertedIndex,
    limit: params.limit,
  });
}

function insertSelectedActionProcedureSupport(
  params: Parameters<typeof insertProcedureLocalSupport>[0],
): void {
  if (params.procedureSupportBudget <= 0) return;
  const selectedProcedureSources = new Set(
    params.selected
      .filter((fact) => fact.memoryKind === 'procedure' && fact.sourceRunId)
      .map((fact) => fact.sourceRunId as string),
  );
  const actionAnchors = params.selected
    .map((fact, index) => ({ fact, index }))
    .filter(
      (entry) =>
        isActionResultOutcome(entry.fact) &&
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
  if (actionAnchors.length === 0) return;

  const sourceRunIds = Array.from(
    new Set(actionAnchors.map((entry) => entry.fact.sourceRunId as string)),
  );
  const procedureFacts = listFactsForSourceRuns(sourceRunIds, {
    memoryKind: 'procedure',
    limit: sourceRunIds.length * 2,
    ...(params.candidateScopes ? { scope: params.candidateScopes } : {}),
    ...(params.options.conversationId
      ? { originConversationId: params.options.conversationId }
      : {}),
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
    if (scored.score <= 0 && scored.relevanceScore <= 0) continue;
    const list = proceduresBySource.get(fact.sourceRunId) ?? [];
    list.push({ fact, scored });
    proceduresBySource.set(fact.sourceRunId, list);
  }

  let inserted = 0;
  for (const anchor of actionAnchors) {
    if (inserted >= params.procedureSupportBudget) break;
    const candidates = proceduresBySource.get(anchor.fact.sourceRunId as string);
    if (!candidates?.length) continue;
    candidates.sort((left, right) => compareSupportCandidates(left, right));
    const support = candidates[0];
    insertSupportAfterAnchor({
      selected: params.selected,
      seenIds: params.seenIds,
      seenKeys: params.seenKeys,
      scoredById: params.scoredById,
      limit: params.limit,
      anchorIndex: anchor.index,
      supportFact: support.fact,
      supportScore: support.scored,
      seenKey: `action_procedure_support:${support.fact.id}`,
    });
    selectedProcedureSources.add(anchor.fact.sourceRunId as string);
    inserted += 1;
  }
}

function insertProcedureUiSupport(params: Parameters<typeof insertProcedureLocalSupport>[0]): void {
  if (params.uiSupportBudget <= 0 || params.selected.length === 0) return;
  let inserted = 0;
  const selectedPreciseUiStateKeys = new Set(
    params.selected
      .filter((fact) => fact.memoryKind === 'ui_field' || fact.memoryKind === 'ui_filter_state')
      .map((fact) => sourceRunStateKey(fact))
      .filter(Boolean),
  );
  const hasSelectedUiInventoryForSource = (sourceRunId: string): boolean =>
    params.selected.some(
      (fact) => fact.sourceRunId === sourceRunId && fact.memoryKind === 'ui_inventory',
    );

  for (
    let index = 0;
    index < params.selected.length && inserted < params.uiSupportBudget;
    index += 1
  ) {
    const anchor = params.selected[index];
    if (anchor.memoryKind !== 'procedure' || !anchor.sourceRunId) continue;
    if (hasSelectedUiInventoryForSource(anchor.sourceRunId)) continue;
    const contexts = sourceRunSupportContexts([anchor], params.scored);
    if (contexts.length === 0) continue;
    const supportFacts = listFactsForSourceRunForwardWindows(contexts, {
      memoryKind: ['ui_inventory'],
      forwardRadius: SOURCE_RUN_SUPPORT_FORWARD_RADIUS,
      stateLimit: SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT,
      limit: contexts.length * SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT,
      ...(params.candidateScopes ? { scope: params.candidateScopes } : {}),
      ...(params.options.conversationId
        ? { originConversationId: params.options.conversationId }
        : {}),
      ...(params.options.taskId ? { originTaskId: params.options.taskId } : {}),
      ...(params.options.includeHistorical ? { includeInvalidated: true } : {}),
      ...(params.options.asOf !== undefined ? { asOf: params.options.asOf } : {}),
    }).filter(
      (fact) =>
        !params.seenIds.has(fact.id) &&
        !selectedPreciseUiStateKeys.has(sourceRunStateKey(fact) ?? ''),
    );
    if (supportFacts.length === 0) continue;
    const supportUnitHits = listFactTermUnitHitsForFacts(
      supportFacts.map((fact) => fact.id),
      params.recallLexicalUnits,
    );
    const supportEntries = supportFacts
      .map((fact) => ({
        fact,
        scored: buildScoredFact({
          fact,
          queryUnits: params.scoringQueryUnits,
          factUnitHits: supportUnitHits.get(fact.id),
          unitWeights: params.unitWeights,
          query: params.query,
          anchorUnitSets: params.anchorUnitSets,
          alwaysIncludePinned: params.alwaysIncludePinned,
          options: params.options,
          now: params.now,
        }),
      }))
      .sort((left, right) => {
        const richnessDiff =
          supportEvidenceRichness(right.fact) - supportEvidenceRichness(left.fact);
        if (richnessDiff !== 0) return richnessDiff;
        return compareSupportCandidates(left, right);
      });
    const support = supportEntries[0];
    if (!support) continue;
    insertSupportAfterAnchor({
      selected: params.selected,
      seenIds: params.seenIds,
      seenKeys: params.seenKeys,
      scoredById: params.scoredById,
      limit: params.limit,
      anchorIndex: index,
      supportFact: support.fact,
      supportScore: support.scored,
      seenKey: `procedure_local_support:${support.fact.id}`,
    });
    inserted += 1;
    index += 1;
  }
}
