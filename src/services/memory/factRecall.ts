// Kavi query-time fact recall. This path is deterministic and local: indexed
// lexical candidates, sparse scoring, source-coherent selection, then support
// grounding for prompt assembly.

import { markFactsRecalled } from './facts/mutations';
import {
  listFactsForSourceRunForwardWindows,
  listFactsForRecallCandidates,
  listFactTermUnitHitsForFacts,
  listFactsForSourceRuns,
  listFactsForSourceRunStateNeighborhoods,
} from './facts/queries';
import { listFactsForSourceRunLexicalMatches } from './facts/sourceRunLexicalMatches';
import { type MemoryFact, type MemoryFactKind, type MemoryFactScope } from './facts/types';
import { selectIndexedRecallLexicalUnits } from './factRecallCandidateUnits';
import { insertProcedureLocalSupport } from './factRecallProcedureSupport';
import { buildRecallLexicalUnits, selectScoringQueryUnits } from './factRecallQueryUnits';
import { rankSourceCoherentEntries } from './factRecallSourceCoherence';
import {
  SOURCE_RUN_CANDIDATE_EXPANSION_KINDS,
  SOURCE_RUN_CANDIDATE_FACTS_PER_SOURCE,
  sourceRunIdsForLocalExpansion,
} from './factRecallSourceExpansion';
import {
  type RecallFactsOptions,
  type RecallFactsTiming,
  type ScoredFact,
} from './factRecallTypes';
import { countLexicalUnits } from './ranking/lexical';
import { quotedSpanUnitSets } from './ranking/quotedSpans';
import {
  primarySelectionGroupKey,
  primaryWorkflowRepresentative,
  selectionDedupeKey,
  sourceRunSupportContexts,
  sourceRunStateKey,
  supportDiversityKey,
  supportSlotCount,
  workflowProcedureRepresentativeForOutcome,
} from './ranking/selection';
import {
  buildQueryUnitWeightsFromHits,
  buildScoredFact,
  selectDiscriminativeScoringUnits,
} from './factRecallScoring';
import {
  isActionResultOutcome,
  rankWorkflowSupportEntries,
  selectedActionResultSourceRuns,
  sourceBalancedSupportEntries,
  supportQueryEvidenceScore,
} from './factRecallSupport';
import { annotateUiInventoryQueryEvidence } from './queryUiEvidence';
import {
  dominantUiSurfaceIdentityScore,
  isUiSurfaceIdentityCompatible,
  pruneUiSurfaceIdentityConflicts,
  selectedUiSurfaceIdentityScore,
} from './uiSurfaceIdentity';

export type { RecallFactsOptions, RecallFactsTiming, ScoredFact } from './factRecallTypes';

const DEFAULT_LIMIT = 8;
const DEFAULT_TEXT_THRESHOLD = 0.04;
const CANDIDATE_POOL_LIMIT = 128;
const CANDIDATE_POOL_MAX = 2_000;
const QUOTED_ANCHOR_LIMIT = 12;
const SOURCE_RUN_SUPPORT_FORWARD_RADIUS = 16;
const SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT = 16;
const SOURCE_RUN_SUPPORT_LEXICAL_PER_RUN_LIMIT = 6;
const SOURCE_RUN_SUPPORT_RADIUS = 2;
const SOURCE_RUN_SUPPORT_PER_RUN_LIMIT = 8;
const WORKFLOW_SUPPORT_ANCHOR_KINDS = new Set<MemoryFactKind>([
  'procedure',
  'ui_inventory',
  'ui_field',
  'ui_filter_state',
  'outcome',
]);

function getCandidateScopes(options: RecallFactsOptions): MemoryFactScope[] | undefined {
  if (!options.scopeHints?.length && !options.conversationId && !options.taskId) {
    return undefined;
  }
  const scopes = new Set<MemoryFactScope>(options.scopeHints ?? []);
  if (options.conversationId) scopes.add('conversation');
  if (options.taskId) scopes.add('session');
  scopes.add('global');
  scopes.add('project');
  return scopes.size > 0 ? Array.from(scopes) : undefined;
}

function isFactEligibleForRecall(fact: MemoryFact, options: RecallFactsOptions): boolean {
  if (fact.scope === 'conversation') {
    return Boolean(options.conversationId && fact.originConversationId === options.conversationId);
  }
  if (fact.scope === 'session') {
    return Boolean(options.taskId && fact.originTaskId === options.taskId);
  }
  return true;
}

function uniqueFactsById(facts: ReadonlyArray<MemoryFact>): MemoryFact[] {
  const byId = new Map<string, MemoryFact>();
  for (const fact of facts) byId.set(fact.id, fact);
  return Array.from(byId.values());
}

function canAnchorWorkflowSupport(fact: MemoryFact): boolean {
  return WORKFLOW_SUPPORT_ANCHOR_KINDS.has(fact.memoryKind);
}

function isProcedureOnlyRecall(options: RecallFactsOptions): boolean {
  const memoryKind = options.memoryKind;
  return (
    memoryKind === 'procedure' ||
    (Array.isArray(memoryKind) && memoryKind.length === 1 && memoryKind[0] === 'procedure')
  );
}

function primaryProcedureSlotLimit(primaryLimit: number, options: RecallFactsOptions): number {
  if (isProcedureOnlyRecall(options)) return primaryLimit;
  return Math.max(1, Math.floor(primaryLimit * 0.25));
}

function addSelectedFact(params: {
  selected: MemoryFact[];
  seenIds: Set<string>;
  seenKeys: Set<string>;
  fact: MemoryFact;
  limit: number;
  dedupeKey?: string | null;
}): boolean {
  if (params.selected.length >= params.limit) return false;
  if (params.seenIds.has(params.fact.id)) return false;
  const key = params.dedupeKey ?? selectionDedupeKey(params.fact);
  if (key && params.seenKeys.has(key)) return false;
  params.selected.push(params.fact);
  params.seenIds.add(params.fact.id);
  if (key) params.seenKeys.add(key);
  return true;
}

async function buildRecallSelection(
  query: string,
  options: RecallFactsOptions,
): Promise<{ facts: MemoryFact[]; scoredFacts: ScoredFact[] }> {
  const totalStarted = Date.now();
  const timing: RecallFactsTiming = {
    queryChars: query.length,
    queryUnitCount: 0,
    candidateCount: 0,
    candidateHitFactCount: 0,
    tokenizeQueryMs: 0,
    candidateFetchMs: 0,
    candidateTermHitsMs: 0,
    unitWeightsMs: 0,
    scoreMs: 0,
    sortMs: 0,
    selectMs: 0,
    totalMs: 0,
  };
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 50));
  const candidatePool = Math.max(
    limit,
    Math.min(options.candidatePoolLimit ?? CANDIDATE_POOL_LIMIT, CANDIDATE_POOL_MAX),
  );
  const alwaysIncludePinned = options.alwaysIncludePinned !== false;
  const trimmedQuery = query.trim();
  const now = options.now ?? options.asOf ?? Date.now();
  const candidateScopes = getCandidateScopes(options);
  const tokenizeStarted = Date.now();
  const queryUnitCounts = countLexicalUnits(trimmedQuery);
  const queryUnits = new Set(queryUnitCounts.keys());
  const anchorUnitSets = quotedSpanUnitSets(trimmedQuery, QUOTED_ANCHOR_LIMIT);
  const anchorLexicalUnits = Array.from(
    new Set(anchorUnitSets.flatMap((anchorUnits) => Array.from(anchorUnits))),
  );
  const recallLexicalUnits = buildRecallLexicalUnits(
    queryUnitCounts,
    anchorLexicalUnits,
    options.lexicalUnitLimit,
  );
  timing.tokenizeQueryMs = Date.now() - tokenizeStarted;
  timing.queryUnitCount = queryUnits.size;

  const candidateFetchStarted = Date.now();
  const indexedRecallLexicalUnits = selectIndexedRecallLexicalUnits(
    recallLexicalUnits,
    anchorLexicalUnits,
  );

  const indexedCandidates = listFactsForRecallCandidates({
    limit: candidatePool,
    selectedLexicalUnits: indexedRecallLexicalUnits,
    ...(options.conversationId ? { scopedRecentConversationId: options.conversationId } : {}),
    ...(options.taskId ? { scopedRecentTaskId: options.taskId } : {}),
    ...(candidateScopes ? { scope: candidateScopes } : {}),
    ...(options.memoryKind ? { memoryKind: options.memoryKind } : {}),
    ...(options.includeHistorical ? { includeInvalidated: true } : {}),
    ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
  });
  const localExpansionSourceRunIds = sourceRunIdsForLocalExpansion(indexedCandidates);
  const sourceRunCandidates =
    localExpansionSourceRunIds.length > 0
      ? listFactsForSourceRunLexicalMatches(localExpansionSourceRunIds, recallLexicalUnits, {
          memoryKind: options.memoryKind ?? SOURCE_RUN_CANDIDATE_EXPANSION_KINDS,
          limit: localExpansionSourceRunIds.length * SOURCE_RUN_CANDIDATE_FACTS_PER_SOURCE,
          factsPerSourceRun: SOURCE_RUN_CANDIDATE_FACTS_PER_SOURCE,
          ...(candidateScopes ? { scope: candidateScopes } : {}),
          ...(options.conversationId ? { originConversationId: options.conversationId } : {}),
          ...(options.taskId ? { originTaskId: options.taskId } : {}),
          ...(options.includeHistorical ? { includeInvalidated: true } : {}),
          ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
        })
      : [];
  const candidates = uniqueFactsById([...indexedCandidates, ...sourceRunCandidates]).filter(
    (fact) => isFactEligibleForRecall(fact, options),
  );
  timing.candidateFetchMs = Date.now() - candidateFetchStarted;
  timing.candidateCount = candidates.length;
  const candidateTermHitsStarted = Date.now();
  const candidateUnitHits = listFactTermUnitHitsForFacts(
    candidates.map((fact) => fact.id),
    recallLexicalUnits,
  );
  timing.candidateTermHitsMs = Date.now() - candidateTermHitsStarted;
  timing.candidateHitFactCount = candidateUnitHits.size;
  const scoringQueryUnits = selectScoringQueryUnits(
    recallLexicalUnits,
    queryUnits,
    candidateUnitHits,
  );

  const unitWeightsStarted = Date.now();
  const initialUnitWeights = buildQueryUnitWeightsFromHits(
    scoringQueryUnits,
    candidates,
    candidateUnitHits,
  );
  const discriminativeScoringUnits = selectDiscriminativeScoringUnits({
    scoringUnits: scoringQueryUnits,
    unitWeights: initialUnitWeights,
    anchorLexicalUnits,
  });
  const unitWeights = buildQueryUnitWeightsFromHits(
    discriminativeScoringUnits,
    candidates,
    candidateUnitHits,
  );
  timing.unitWeightsMs = Date.now() - unitWeightsStarted;

  const scoreStarted = Date.now();
  const scored = candidates.map((fact) =>
    buildScoredFact({
      fact,
      queryUnits: discriminativeScoringUnits,
      factUnitHits: candidateUnitHits.get(fact.id),
      unitWeights,
      query: trimmedQuery,
      anchorUnitSets,
      alwaysIncludePinned,
      options,
      now,
    }),
  );
  timing.scoreMs = Date.now() - scoreStarted;
  const sortStarted = Date.now();
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.fact.updatedAt - a.fact.updatedAt;
  });
  timing.sortMs = Date.now() - sortStarted;
  const scoredById = new Map(scored.map((entry) => [entry.fact.id, entry]));
  const dominantUiSurfaceIdentity = dominantUiSurfaceIdentityScore(scored);

  const selectStarted = Date.now();
  const selected: MemoryFact[] = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const primaryGroups = new Set<string>();
  const reservedSupportSlots = supportSlotCount(limit);
  const primaryLimit = Math.max(1, limit - reservedSupportSlots);
  const primaryProcedureLimit = primaryProcedureSlotLimit(primaryLimit, options);
  let selectedPrimaryProcedures = 0;
  if (alwaysIncludePinned) {
    for (const entry of scored) {
      if (!entry.fact.pinned) continue;
      const added = addSelectedFact({
        selected,
        seenIds,
        seenKeys,
        fact: entry.fact,
        limit: primaryLimit,
      });
      if (added) primaryGroups.add(primarySelectionGroupKey(entry.fact));
      if (selected.length >= primaryLimit) break;
    }
  }
  if (trimmedQuery && selected.length < limit) {
    const threshold = options.threshold ?? DEFAULT_TEXT_THRESHOLD;
    const workflowProceduresBySourceRun = new Map<string, MemoryFact[]>();
    const outcomeSourceRunIds = Array.from(
      new Set(
        scored
          .filter(
            (entry) =>
              entry.fact.memoryKind === 'outcome' &&
              !isActionResultOutcome(entry.fact) &&
              entry.fact.sourceRunId &&
              (entry.relevanceScore >= threshold || entry.score >= threshold),
          )
          .map((entry) => entry.fact.sourceRunId as string),
      ),
    );
    if (outcomeSourceRunIds.length > 0) {
      const workflowProcedures = listFactsForSourceRuns(outcomeSourceRunIds, {
        memoryKind: 'procedure',
        limit: Math.min(outcomeSourceRunIds.length * 2, CANDIDATE_POOL_MAX),
        ...(candidateScopes ? { scope: candidateScopes } : {}),
        ...(options.conversationId ? { originConversationId: options.conversationId } : {}),
        ...(options.taskId ? { originTaskId: options.taskId } : {}),
        ...(options.includeHistorical ? { includeInvalidated: true } : {}),
        ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
      });
      for (const procedure of workflowProcedures) {
        if (!procedure.sourceRunId) continue;
        const procedures = workflowProceduresBySourceRun.get(procedure.sourceRunId) ?? [];
        procedures.push(procedure);
        workflowProceduresBySourceRun.set(procedure.sourceRunId, procedures);
      }
    }
    for (const entry of rankSourceCoherentEntries(scored)) {
      if (entry.relevanceScore < threshold && entry.score < threshold) continue;
      if (!isUiSurfaceIdentityCompatible(entry, dominantUiSurfaceIdentity)) continue;
      if (
        entry.fact.memoryKind === 'procedure' &&
        selectedPrimaryProcedures >= primaryProcedureLimit
      ) {
        continue;
      }
      const groupKey = primarySelectionGroupKey(entry.fact);
      if (primaryGroups.has(groupKey)) continue;
      let representative = isActionResultOutcome(entry.fact)
        ? entry
        : (primaryWorkflowRepresentative(entry, scored, threshold) as ScoredFact);
      if (
        representative.fact.id === entry.fact.id &&
        entry.fact.sourceRunId &&
        !isActionResultOutcome(entry.fact)
      ) {
        const procedure = workflowProcedureRepresentativeForOutcome(
          entry.fact,
          workflowProceduresBySourceRun.get(entry.fact.sourceRunId) ?? [],
        );
        if (procedure) representative = { ...entry, fact: procedure };
      }
      const added = addSelectedFact({
        selected,
        seenIds,
        seenKeys,
        fact: representative.fact,
        limit: primaryLimit,
      });
      if (added) {
        primaryGroups.add(groupKey);
        if (representative.fact.memoryKind === 'procedure') selectedPrimaryProcedures += 1;
        if (representative.fact.id !== entry.fact.id) {
          scoredById.set(representative.fact.id, representative as ScoredFact);
        }
      }
      if (selected.length >= primaryLimit) break;
    }
  }

  const seenUiSupportDiversityKeys = new Set(
    selected
      .filter((fact) => fact.memoryKind === 'ui_inventory')
      .map((fact) => supportDiversityKey(fact))
      .filter(Boolean),
  );
  const seenUiSupportDiversitySourceKeys = new Set(
    selected
      .filter((fact) => fact.memoryKind === 'ui_inventory')
      .map((fact) => {
        const diversityKey = supportDiversityKey(fact);
        return diversityKey ? `${fact.sourceRunId ?? ''}:${diversityKey}` : null;
      })
      .filter(Boolean),
  );

  if (trimmedQuery && selected.length < limit && reservedSupportSlots > 0) {
    const supportAnchors = selected.filter(canAnchorWorkflowSupport);
    const supportContexts = sourceRunSupportContexts(supportAnchors, scored);
    const exactSupportContextKeys = new Set(
      supportContexts.map((context) => `${context.sourceRunId}:${context.stateIndex}`),
    );
    const selectedSourceRuns = Array.from(
      new Set(supportAnchors.map((fact) => fact.sourceRunId).filter(Boolean) as string[]),
    );
    const supportLimit = Math.min(limit, selected.length + reservedSupportSlots);
    const supportFactsById = new Map<string, MemoryFact>();
    const forwardFacts = listFactsForSourceRunForwardWindows(supportContexts, {
      memoryKind: ['ui_inventory', 'ui_field', 'ui_filter_state'],
      forwardRadius: SOURCE_RUN_SUPPORT_FORWARD_RADIUS,
      stateLimit: SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT,
      limit: supportContexts.length * SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT,
      ...(candidateScopes ? { scope: candidateScopes } : {}),
      ...(options.conversationId ? { originConversationId: options.conversationId } : {}),
      ...(options.taskId ? { originTaskId: options.taskId } : {}),
      ...(options.includeHistorical ? { includeInvalidated: true } : {}),
      ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
    });
    for (const fact of forwardFacts) {
      if (
        seenIds.has(fact.id) ||
        !fact.sourceRunId ||
        !selectedSourceRuns.includes(fact.sourceRunId)
      ) {
        continue;
      }
      supportFactsById.set(fact.id, fact);
    }
    const actionResultSupportContexts = sourceRunSupportContexts(
      supportAnchors.filter(isActionResultOutcome),
      scored,
    );
    if (actionResultSupportContexts.length > 0) {
      const forwardOutcomeFacts = listFactsForSourceRunForwardWindows(actionResultSupportContexts, {
        memoryKind: ['outcome'],
        forwardRadius: SOURCE_RUN_SUPPORT_FORWARD_RADIUS,
        stateLimit: SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT,
        limit: actionResultSupportContexts.length * SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT,
        ...(candidateScopes ? { scope: candidateScopes } : {}),
        ...(options.conversationId ? { originConversationId: options.conversationId } : {}),
        ...(options.taskId ? { originTaskId: options.taskId } : {}),
        ...(options.includeHistorical ? { includeInvalidated: true } : {}),
        ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
      });
      for (const fact of forwardOutcomeFacts) {
        if (
          seenIds.has(fact.id) ||
          !fact.sourceRunId ||
          !selectedSourceRuns.includes(fact.sourceRunId)
        ) {
          continue;
        }
        supportFactsById.set(fact.id, fact);
      }
    }
    for (const sourceRunId of selectedSourceRuns) {
      const contextsForRun = supportContexts.filter(
        (context) => context.sourceRunId === sourceRunId,
      );
      if (contextsForRun.length === 0) continue;
      const supportFacts = listFactsForSourceRunStateNeighborhoods(contextsForRun, {
        memoryKind: ['ui_inventory', 'ui_field', 'ui_filter_state'],
        preferAdjacent: true,
        radius: SOURCE_RUN_SUPPORT_RADIUS,
        limit: SOURCE_RUN_SUPPORT_PER_RUN_LIMIT,
        ...(candidateScopes ? { scope: candidateScopes } : {}),
        ...(options.conversationId ? { originConversationId: options.conversationId } : {}),
        ...(options.taskId ? { originTaskId: options.taskId } : {}),
        ...(options.includeHistorical ? { includeInvalidated: true } : {}),
        ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
      });
      for (const fact of supportFacts) {
        if (seenIds.has(fact.id) || fact.sourceRunId !== sourceRunId) continue;
        supportFactsById.set(fact.id, fact);
      }
    }
    const lexicalSupportFacts = listFactsForSourceRunLexicalMatches(
      selectedSourceRuns,
      recallLexicalUnits,
      {
        memoryKind: ['ui_inventory', 'ui_field', 'ui_filter_state', 'outcome'],
        limit: selectedSourceRuns.length * SOURCE_RUN_SUPPORT_LEXICAL_PER_RUN_LIMIT,
        ...(candidateScopes ? { scope: candidateScopes } : {}),
        ...(options.conversationId ? { originConversationId: options.conversationId } : {}),
        ...(options.taskId ? { originTaskId: options.taskId } : {}),
        ...(options.includeHistorical ? { includeInvalidated: true } : {}),
        ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
      },
    );
    for (const fact of lexicalSupportFacts) {
      if (
        seenIds.has(fact.id) ||
        !fact.sourceRunId ||
        !selectedSourceRuns.includes(fact.sourceRunId)
      ) {
        continue;
      }
      if (
        isActionResultOutcome(fact) &&
        selectedActionResultSourceRuns(selected).has(fact.sourceRunId)
      ) {
        continue;
      }
      supportFactsById.set(fact.id, fact);
    }
    const supportFacts = Array.from(supportFactsById.values());
    const supportUnitHits = listFactTermUnitHitsForFacts(
      supportFacts.map((fact) => fact.id),
      recallLexicalUnits,
    );
    const sourceRunSupportRank = new Map(
      selectedSourceRuns.map((sourceRunId, index) => [sourceRunId, index]),
    );
    const supportEntries = supportFacts.map((fact) => ({
      fact,
      exactContext: exactSupportContextKeys.has(sourceRunStateKey(fact) ?? ''),
      queryEvidenceScore: supportQueryEvidenceScore(fact, discriminativeScoringUnits, unitWeights),
      scored: buildScoredFact({
        fact,
        queryUnits: discriminativeScoringUnits,
        factUnitHits: supportUnitHits.get(fact.id),
        unitWeights,
        query: trimmedQuery,
        anchorUnitSets,
        alwaysIncludePinned,
        options,
        now,
      }),
    }));
    const rankedSupportEntries = rankWorkflowSupportEntries({
      entries: supportEntries,
      sourceRunSupportRank,
    });
    const supportEntriesForSelection = sourceBalancedSupportEntries({
      entries: rankedSupportEntries,
      selectedSourceRuns,
      supportSlots: reservedSupportSlots,
    });
    const sourceBalancedSupportIds = new Set(
      supportEntriesForSelection
        .slice(0, Math.min(reservedSupportSlots, selectedSourceRuns.length))
        .map((entry) => entry.fact.id),
    );
    for (const entry of supportEntriesForSelection) {
      const diversityKey = supportDiversityKey(entry.fact);
      const diversitySourceKey = diversityKey
        ? `${entry.fact.sourceRunId ?? ''}:${diversityKey}`
        : null;
      const isSourceBalancedSupport = sourceBalancedSupportIds.has(entry.fact.id);
      if (diversitySourceKey && seenUiSupportDiversitySourceKeys.has(diversitySourceKey)) {
        continue;
      }
      if (
        diversityKey &&
        seenUiSupportDiversityKeys.has(diversityKey) &&
        !isSourceBalancedSupport
      ) {
        continue;
      }
      const added = addSelectedFact({
        selected,
        seenIds,
        seenKeys,
        fact: entry.fact,
        limit: supportLimit,
        dedupeKey: isSourceBalancedSupport
          ? `source_balanced_support:${entry.fact.sourceRunId ?? ''}:${diversityKey ?? entry.fact.id}`
          : diversityKey,
      });
      if (added) {
        if (diversityKey) seenUiSupportDiversityKeys.add(diversityKey);
        if (diversitySourceKey) seenUiSupportDiversitySourceKeys.add(diversitySourceKey);
        scoredById.set(entry.fact.id, entry.scored);
      }
      if (selected.length >= supportLimit) break;
    }
  }

  const identityPrunedSelected = pruneUiSurfaceIdentityConflicts(selected, scoredById);
  if (identityPrunedSelected.length !== selected.length) {
    selected.splice(0, selected.length, ...identityPrunedSelected);
  }
  const fallbackUiSurfaceIdentity = Math.max(
    dominantUiSurfaceIdentity,
    selectedUiSurfaceIdentityScore(selected, scoredById),
  );

  if (trimmedQuery && selected.length < limit) {
    const threshold = options.threshold ?? DEFAULT_TEXT_THRESHOLD;
    const selectedPreciseUiStateKeys = new Set(
      selected
        .filter((fact) => fact.memoryKind === 'ui_field' || fact.memoryKind === 'ui_filter_state')
        .map((fact) => sourceRunStateKey(fact))
        .filter(Boolean),
    );
    for (const entry of scored) {
      if (entry.relevanceScore < threshold && entry.score < threshold) continue;
      if (!isUiSurfaceIdentityCompatible(entry, fallbackUiSurfaceIdentity)) continue;
      if (
        entry.fact.memoryKind === 'ui_inventory' &&
        selectedPreciseUiStateKeys.has(sourceRunStateKey(entry.fact) ?? '')
      ) {
        continue;
      }
      if (
        isActionResultOutcome(entry.fact) &&
        entry.fact.sourceRunId &&
        selectedActionResultSourceRuns(selected).has(entry.fact.sourceRunId)
      ) {
        continue;
      }
      const diversityKey =
        entry.fact.memoryKind === 'ui_inventory' ? supportDiversityKey(entry.fact) : null;
      if (diversityKey && seenUiSupportDiversityKeys.has(diversityKey)) continue;
      const added = addSelectedFact({ selected, seenIds, seenKeys, fact: entry.fact, limit });
      if (added && diversityKey) seenUiSupportDiversityKeys.add(diversityKey);
      if (selected.length >= limit) break;
    }
  }

  if (trimmedQuery) {
    const selectedUiSupportCount = selected.filter(
      (fact) => fact.memoryKind === 'ui_inventory',
    ).length;
    const selectedProcedureCount = selected.filter(
      (fact) => fact.memoryKind === 'procedure',
    ).length;
    const hasActionResultSupportAnchor = selected.some(isActionResultOutcome);
    const availableProcedureSupportSlots = Math.max(
      0,
      limit - selected.length,
      reservedSupportSlots - selectedUiSupportCount,
    );
    insertProcedureLocalSupport({
      selected,
      seenIds,
      seenKeys,
      scoredById,
      scored,
      limit,
      uiSupportBudget: Math.max(0, reservedSupportSlots - selectedUiSupportCount),
      procedureSupportBudget:
        selectedProcedureCount === 0 && hasActionResultSupportAnchor
          ? Math.min(1, availableProcedureSupportSlots)
          : 0,
      candidateScopes,
      options,
      scoringQueryUnits: discriminativeScoringUnits,
      recallLexicalUnits,
      unitWeights,
      query: trimmedQuery,
      anchorUnitSets,
      alwaysIncludePinned,
      now,
    });
  }

  timing.selectMs = Date.now() - selectStarted;
  timing.totalMs = Date.now() - totalStarted;
  options.onTiming?.(timing);

  const annotatedFacts = annotateUiInventoryQueryEvidence(trimmedQuery, selected);
  return {
    facts: annotatedFacts,
    scoredFacts: annotatedFacts
      .map((fact) => {
        const scoredFact = scoredById.get(fact.id);
        return scoredFact ? { ...scoredFact, fact } : null;
      })
      .filter(Boolean) as ScoredFact[],
  };
}

export async function recallFactsForQuery(
  query: string,
  options: RecallFactsOptions = {},
): Promise<MemoryFact[]> {
  const now = options.now ?? options.asOf ?? Date.now();
  const selection = await buildRecallSelection(query, options);

  markFactsRecalled(
    selection.facts.map((fact) => fact.id),
    now,
  );
  return selection.facts;
}

export async function recallScoredFactsForQuery(
  query: string,
  options: RecallFactsOptions = {},
): Promise<ScoredFact[]> {
  const selection = await buildRecallSelection(query, options);
  return selection.scoredFacts;
}
