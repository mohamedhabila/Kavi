import {
  listFactsForSourceRunForwardWindows,
  listFactsForSourceRuns,
  listFactTermUnitHitsForFacts,
} from './facts/queries';
import type { MemoryFact, MemoryFactScope } from './facts/types';
import { buildScoredFact } from './factRecallScoring';
import type { RecallFactsOptions, ScoredFact } from './factRecallTypes';
import { compareSupportCandidates, sourceRunStateKey } from './ranking/selection';
import { countLexicalUnits } from './ranking/lexical';
import { isActionResultOutcome, supportEvidenceRichness } from './factRecallSupport';
import { parseJsonRecord } from './factJson';
import {
  compactProcedureTraceActionTransitions,
  compactProcedureTraceSurfaceTrail,
} from './procedureTraceSummary';

const PROCEDURE_UI_SUPPORT_FORWARD_RADIUS = 2;
const PROCEDURE_UI_SUPPORT_CONTEXT_LIMIT = 2;
const PROCEDURE_UI_SUPPORT_FACTS_PER_STATE_KIND = 6;
const SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT = 16;

type ProcedureSupportOverflowPolicy = 'default' | 'replace_unrelated_context';

export function insertProcedureLocalSupport(params: {
  selected: MemoryFact[];
  seenIds: Set<string>;
  seenKeys: Set<string>;
  scoredById: Map<string, ScoredFact>;
  scored: ReadonlyArray<ScoredFact>;
  limit: number;
  uiSupportBudget: number;
  procedureSupportBudget: number;
  uiProcedureSupportBudget: number;
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
    params.uiProcedureSupportBudget <= 0 &&
    params.selected.length === 0
  ) {
    return;
  }
  insertSelectedActionProcedureSupport(params);
  insertSelectedUiProcedureSupport(params);
  insertProcedureUiSupport(params);
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
    const unrelatedProcedure = findOverflowIndex(
      params,
      (fact) =>
        fact.memoryKind === 'procedure' &&
        (!params.protectedSourceRunId || fact.sourceRunId !== params.protectedSourceRunId),
    );
    if (unrelatedProcedure >= 0) return unrelatedProcedure;
    const unrelatedOutcome = findOverflowIndex(
      params,
      (fact) =>
        fact.memoryKind === 'outcome' &&
        (!params.protectedSourceRunId || fact.sourceRunId !== params.protectedSourceRunId),
    );
    if (unrelatedOutcome >= 0) return unrelatedOutcome;
    return findOverflowIndex(
      params,
      (fact) => !params.protectedSourceRunId || fact.sourceRunId !== params.protectedSourceRunId,
    );
  }
  const outcomeIndex = findOverflowIndex(params, (fact) => fact.memoryKind === 'outcome');
  if (outcomeIndex >= 0) return outcomeIndex;
  return findOverflowIndex(params, () => true);
}

function findOverflowIndex(
  params: {
    selected: MemoryFact[];
    insertedIndex: number;
  },
  canRemove: (fact: MemoryFact) => boolean,
): number {
  for (let index = params.selected.length - 1; index >= 0; index -= 1) {
    if (index === params.insertedIndex) continue;
    const fact = params.selected[index];
    if (fact && canRemove(fact)) return index;
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

function insertSelectedActionProcedureSupport(
  params: Parameters<typeof insertProcedureLocalSupport>[0],
): void {
  insertSelectedProcedureSupportForAnchors({
    params,
    budget: params.procedureSupportBudget,
    canAnchor: isActionResultOutcome,
    allowOverflowReplacement: true,
    requireSupportRelevance: false,
    seenKeyPrefix: 'action_procedure_support',
  });
}

function insertSelectedUiProcedureSupport(
  params: Parameters<typeof insertProcedureLocalSupport>[0],
): void {
  insertSelectedProcedureSupportForAnchors({
    params,
    budget: params.uiProcedureSupportBudget,
    canAnchor: isUiProcedureSupportAnchor,
    allowOverflowReplacement: true,
    requireSupportRelevance: false,
    overflowPolicy: 'replace_unrelated_context',
    seenKeyPrefix: 'ui_procedure_support',
  });
}

function insertSelectedProcedureSupportForAnchors(input: {
  params: Parameters<typeof insertProcedureLocalSupport>[0];
  budget: number;
  canAnchor: (fact: MemoryFact) => boolean;
  allowOverflowReplacement: boolean;
  requireSupportRelevance: boolean;
  overflowPolicy?: ProcedureSupportOverflowPolicy;
  seenKeyPrefix: string;
}): void {
  const {
    params,
    budget,
    canAnchor,
    allowOverflowReplacement,
    requireSupportRelevance,
    overflowPolicy,
    seenKeyPrefix,
  } = input;
  if (budget <= 0) return;
  const selectedProcedureSources = new Set(
    params.selected
      .filter((fact) => fact.memoryKind === 'procedure' && fact.sourceRunId)
      .map((fact) => fact.sourceRunId as string),
  );
  const actionAnchors = params.selected
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
    if (requireSupportRelevance && scored.score <= 0 && scored.relevanceScore <= 0) continue;
    const list = proceduresBySource.get(fact.sourceRunId) ?? [];
    list.push({ fact, scored });
    proceduresBySource.set(fact.sourceRunId, list);
  }

  let inserted = 0;
  for (const anchor of actionAnchors) {
    if (inserted >= budget) break;
    const candidates = proceduresBySource.get(anchor.fact.sourceRunId as string);
    if (!candidates?.length) continue;
    candidates.sort((left, right) => compareSupportCandidates(left, right));
    const support = candidates[0];
    if (!allowOverflowReplacement && params.selected.length >= params.limit) break;
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
      overflowPolicy: overflowPolicy ?? 'default',
      protectedSourceRunId: anchor.fact.sourceRunId as string,
    });
    if (!didInsert) continue;
    selectedProcedureSources.add(anchor.fact.sourceRunId as string);
    inserted += 1;
  }
}

function isUiProcedureSupportAnchor(fact: MemoryFact): boolean {
  return (
    fact.memoryKind === 'ui_inventory' ||
    fact.memoryKind === 'ui_field' ||
    fact.memoryKind === 'ui_filter_state'
  );
}

function procedureBoundarySupportContexts(
  fact: MemoryFact,
  queryUnits: ReadonlyArray<string>,
): Array<{ sourceRunId: string; stateIndex: string | number }> {
  if (fact.memoryKind !== 'procedure' || !fact.sourceRunId) return [];
  const parsed = parseJsonRecord(fact.objectText);
  if (!parsed) return [];
  const storedActionTransitions = Array.isArray(parsed.actionTransitions)
    ? parsed.actionTransitions
    : null;
  const storedSurfaceTrail = Array.isArray(parsed.surfaceTrail) ? parsed.surfaceTrail : null;
  const queryActionTransitions = queryProcedureActionTransitions(parsed);
  const querySurfaceTrail = queryProcedureSurfaceTrail(parsed);
  const fallbackActionTransitions = storedActionTransitions;
  const fallbackSurfaceTrail = storedSurfaceTrail;
  const actionTransitions = queryActionTransitions;
  const surfaceTrail = querySurfaceTrail;
  const contexts: Array<{ sourceRunId: string; stateIndex: string | number }> = [];
  const seen = new Set<string>();
  const add = (value: unknown): void => {
    if (contexts.length >= PROCEDURE_UI_SUPPORT_CONTEXT_LIMIT) return;
    const stateIndex = stateIndexValue(value);
    if (stateIndex === null) return;
    const key = String(stateIndex);
    if (seen.has(key)) return;
    seen.add(key);
    contexts.push({ sourceRunId: fact.sourceRunId as string, stateIndex });
  };

  if (
    addBoundaryStates(
      queryRelevantProcedureEntryStateIndexes(actionTransitions, 'toStateIndex', queryUnits),
      add,
    )
  ) {
    return contexts;
  }
  if (
    addBoundaryStates(
      queryRelevantProcedureEntryStateIndexes(surfaceTrail, 'stateIndex', queryUnits),
      add,
    )
  ) {
    return contexts;
  }
  if (addBoundaryStates(actionTransitionDestinationStateIndexes(fallbackActionTransitions), add)) {
    return contexts;
  }
  if (addBoundaryStates(actionStepStateIndexes(parsed.steps), add)) return contexts;
  if (addBoundaryStates(entryStateIndexes(fallbackSurfaceTrail), add)) return contexts;
  addBoundaryStates(entryStateIndexes(parsed.steps), add);
  return contexts;
}

function queryProcedureActionTransitions(parsed: Record<string, unknown>): unknown {
  return Array.isArray(parsed.actionTransitions)
    ? parsed.actionTransitions
    : compactProcedureTraceActionTransitions(parsed.steps);
}

function queryProcedureSurfaceTrail(parsed: Record<string, unknown>): unknown {
  return Array.isArray(parsed.surfaceTrail)
    ? parsed.surfaceTrail
    : compactProcedureTraceSurfaceTrail(parsed.steps);
}

function queryRelevantProcedureEntryStateIndexes(
  value: unknown,
  stateIndexKey: string,
  queryUnits: ReadonlyArray<string>,
): Array<string | number> {
  if (!Array.isArray(value) || queryUnits.length === 0) return [];
  const queryUnitSet = new Set(queryUnits);
  const candidates: Array<{ stateIndex: string | number; score: number; index: number }> = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const stateIndex = stateIndexValue((entry as Record<string, unknown>)[stateIndexKey]);
    if (stateIndex === null) return;
    const score = lexicalUnitOverlapScore(queryUnitSet, collectStructuredText(entry).join(' '));
    if (score <= 0) return;
    candidates.push({ stateIndex, score, index });
  });
  return candidates
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .map((candidate) => candidate.stateIndex);
}

function collectStructuredText(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' && value.trim()) {
    out.push(value);
    return out;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.push(String(value));
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const entry of value) collectStructuredText(entry, out);
    return out;
  }
  for (const entry of Object.values(value)) collectStructuredText(entry, out);
  return out;
}

function lexicalUnitOverlapScore(queryUnits: ReadonlySet<string>, text: string): number {
  if (queryUnits.size === 0 || !text.trim()) return 0;
  const textUnits = countLexicalUnits(text);
  let matched = 0;
  for (const unit of queryUnits) {
    if (textUnits.has(unit)) matched += 1;
  }
  return matched / queryUnits.size;
}

function addBoundaryStates(
  values: ReadonlyArray<string | number>,
  add: (value: unknown) => void,
): boolean {
  if (values.length === 0) return false;
  for (const value of values) add(value);
  return true;
}

function actionTransitionDestinationStateIndexes(value: unknown): Array<string | number> {
  if (!Array.isArray(value)) return [];
  const indexes: Array<string | number> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    addStateIndex(indexes, (entry as Record<string, unknown>).toStateIndex);
  }
  return indexes.reverse();
}

function entryStateIndexes(value: unknown): Array<string | number> {
  if (!Array.isArray(value)) return [];
  const indexes: Array<string | number> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    addStateIndex(indexes, (entry as Record<string, unknown>).stateIndex);
  }
  return indexes;
}

function actionStepStateIndexes(value: unknown): Array<string | number> {
  if (!Array.isArray(value)) return [];
  const indexes: Array<string | number> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (typeof (entry as Record<string, unknown>).action !== 'string') continue;
    addStateIndex(indexes, (entry as Record<string, unknown>).stateIndex);
  }
  return indexes;
}

function addStateIndex(indexes: Array<string | number>, value: unknown): void {
  const stateIndex = stateIndexValue(value);
  if (stateIndex === null) return;
  indexes.push(stateIndex);
}

function stateIndexValue(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function insertProcedureUiSupport(params: Parameters<typeof insertProcedureLocalSupport>[0]): void {
  if (params.uiSupportBudget <= 0 || params.selected.length === 0) return;
  let inserted = 0;
  const selectedUiSupportCountBySource = new Map<string, number>();
  for (const fact of params.selected) {
    if (
      !fact.sourceRunId ||
      (fact.memoryKind !== 'ui_inventory' &&
        fact.memoryKind !== 'ui_field' &&
        fact.memoryKind !== 'ui_filter_state')
    ) {
      continue;
    }
    selectedUiSupportCountBySource.set(
      fact.sourceRunId,
      (selectedUiSupportCountBySource.get(fact.sourceRunId) ?? 0) + 1,
    );
  }
  const supportQueryUnits = Array.from(params.scoringQueryUnits);
  const procedureAnchors = params.selected
    .map((fact, index) => ({ fact, index }))
    .filter((entry) => entry.fact.memoryKind === 'procedure' && entry.fact.sourceRunId)
    .sort((left, right) => {
      const leftQueryRelevance = procedureBoundaryQueryRelevanceScore(left.fact, supportQueryUnits);
      const rightQueryRelevance = procedureBoundaryQueryRelevanceScore(
        right.fact,
        supportQueryUnits,
      );
      if (leftQueryRelevance !== rightQueryRelevance) {
        return rightQueryRelevance - leftQueryRelevance;
      }
      const leftSupportCount =
        selectedUiSupportCountBySource.get(left.fact.sourceRunId as string) ?? 0;
      const rightSupportCount =
        selectedUiSupportCountBySource.get(right.fact.sourceRunId as string) ?? 0;
      if (leftSupportCount !== rightSupportCount) return leftSupportCount - rightSupportCount;
      return left.index - right.index;
    });
  const selectedProcedureSourceCount = new Set(
    procedureAnchors.map((entry) => entry.fact.sourceRunId as string),
  ).size;
  const supportPerProcedureLimit = selectedProcedureSourceCount > 1 ? 1 : params.uiSupportBudget;
  const selectedInventoryStateKeys = new Set(
    params.selected
      .filter((fact) => fact.memoryKind === 'ui_inventory')
      .map((fact) => sourceRunStateKey(fact))
      .filter(Boolean),
  );
  for (const anchorEntry of procedureAnchors) {
    if (inserted >= params.uiSupportBudget) break;
    const anchor = anchorEntry.fact;
    if (!anchor.sourceRunId) continue;
    const contexts = procedureBoundarySupportContexts(anchor, supportQueryUnits);
    if (contexts.length === 0) continue;
    const contextRank = new Map(
      contexts.map((context, contextIndex) => [
        `${context.sourceRunId}:${context.stateIndex}`,
        contextIndex,
      ]),
    );
    const supportFacts = listFactsForSourceRunForwardWindows(contexts, {
      memoryKind: ['ui_inventory', 'ui_field', 'ui_filter_state'],
      forwardRadius: PROCEDURE_UI_SUPPORT_FORWARD_RADIUS,
      factsPerStateKind: PROCEDURE_UI_SUPPORT_FACTS_PER_STATE_KIND,
      includeAnchorState: true,
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
        !selectedInventoryStateKeys.has(sourceRunStateKey(fact) ?? ''),
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
        const leftContextRank =
          contextRank.get(sourceRunStateKey(left.fact) ?? '') ?? Number.MAX_SAFE_INTEGER;
        const rightContextRank =
          contextRank.get(sourceRunStateKey(right.fact) ?? '') ?? Number.MAX_SAFE_INTEGER;
        if (leftContextRank !== rightContextRank) return leftContextRank - rightContextRank;
        const scoredDiff = compareSupportCandidates(left, right);
        if (scoredDiff !== 0) return scoredDiff;
        const richnessDiff =
          supportEvidenceRichness(right.fact) - supportEvidenceRichness(left.fact);
        if (richnessDiff !== 0) return richnessDiff;
        return 0;
      });
    let insertedForAnchor = 0;
    for (const support of supportEntries) {
      if (inserted >= params.uiSupportBudget) break;
      if (insertedForAnchor >= supportPerProcedureLimit) break;
      if (params.seenIds.has(support.fact.id)) continue;
      const anchorIndex = params.selected.indexOf(anchor);
      if (anchorIndex < 0) break;
      const didInsert = insertSupportAfterAnchor({
        selected: params.selected,
        seenIds: params.seenIds,
        seenKeys: params.seenKeys,
        scoredById: params.scoredById,
        limit: params.limit,
        anchorIndex: anchorIndex + insertedForAnchor,
        supportFact: support.fact,
        supportScore: support.scored,
        seenKey: `procedure_local_support:${support.fact.id}`,
        overflowPolicy: 'default',
        protectedSourceRunId: anchor.sourceRunId,
      });
      if (!didInsert) continue;
      inserted += 1;
      insertedForAnchor += 1;
    }
  }
}

function procedureBoundaryQueryRelevanceScore(
  fact: MemoryFact,
  queryUnits: ReadonlyArray<string>,
): number {
  if (fact.memoryKind !== 'procedure' || queryUnits.length === 0) return 0;
  const parsed = parseJsonRecord(fact.objectText);
  if (!parsed) return 0;
  const actionTransitions = queryProcedureActionTransitions(parsed);
  const surfaceTrail = queryProcedureSurfaceTrail(parsed);
  const queryUnitSet = new Set(queryUnits);
  return Math.max(
    maxProcedureEntryQueryOverlap(actionTransitions, 'toStateIndex', queryUnitSet),
    maxProcedureEntryQueryOverlap(surfaceTrail, 'stateIndex', queryUnitSet),
  );
}

function maxProcedureEntryQueryOverlap(
  value: unknown,
  stateIndexKey: string,
  queryUnits: ReadonlySet<string>,
): number {
  if (!Array.isArray(value) || queryUnits.size === 0) return 0;
  let best = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (stateIndexValue((entry as Record<string, unknown>)[stateIndexKey]) === null) continue;
    best = Math.max(
      best,
      lexicalUnitOverlapScore(queryUnits, collectStructuredText(entry).join(' ')),
    );
  }
  return best;
}
