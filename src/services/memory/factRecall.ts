// Kavi query-time fact recall. This path is deterministic and local: indexed
// lexical candidates, sparse scoring, source-coherent selection, and compact
// workflow support for agent-run evidence.

import { markFactsRecalled } from './facts/mutations';
import {
  listFactTermUnitHitsForFacts,
  listFactsForRecallCandidates,
  listFactsForSourceRuns,
} from './facts/queries';
import {
  listFactsForSourceRunLexicalMatches,
  listSourceRunIdsForLexicalEvidence,
} from './facts/sourceRunLexicalMatches';
import { type MemoryFact, type MemoryFactScope } from './facts/types';
import { promoteSelectedActionResultContinuations } from './factRecallActionContinuations';
import { selectIndexedRecallLexicalUnits } from './factRecallCandidateUnits';
import { insertProcedureLocalSupport } from './factRecallProcedureSupport';
import { buildRecallLexicalUnits, selectScoringQueryUnits } from './factRecallQueryUnits';
import { rankSourceCoherentEntries } from './factRecallSourceCoherence';
import {
  SOURCE_RUN_CANDIDATE_EXPANSION_KINDS,
  SOURCE_RUN_CANDIDATE_FACTS_PER_SOURCE,
  SOURCE_RUN_CANDIDATE_SOURCE_LIMIT,
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
  bestStandaloneProcedureCandidate,
  primaryProcedureSlotLimit,
} from './factRecallProcedureSelection';
import {
  primarySelectionGroupKey,
  primaryWorkflowRepresentative,
  selectionDedupeKey,
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
  isImmediateActionResultContinuation,
  selectedActionResultSourceRuns,
} from './factRecallSupport';

export type { RecallFactsOptions, RecallFactsTiming, ScoredFact } from './factRecallTypes';

const DEFAULT_LIMIT = 8;
const DEFAULT_TEXT_THRESHOLD = 0.04;
const CANDIDATE_POOL_LIMIT = 128;
const CANDIDATE_POOL_MAX = 2_000;
const QUOTED_ANCHOR_LIMIT = 12;

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
  const lexicalEvidenceSourceRunIds = listSourceRunIdsForLexicalEvidence(
    indexedRecallLexicalUnits,
    {
      memoryKind: options.memoryKind ?? SOURCE_RUN_CANDIDATE_EXPANSION_KINDS,
      limit: SOURCE_RUN_CANDIDATE_SOURCE_LIMIT,
      ...(candidateScopes ? { scope: candidateScopes } : {}),
      ...(options.conversationId ? { originConversationId: options.conversationId } : {}),
      ...(options.taskId ? { originTaskId: options.taskId } : {}),
      ...(options.includeHistorical ? { includeInvalidated: true } : {}),
      ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
    },
  );
  const sourceRunEvidenceRank = new Map(
    lexicalEvidenceSourceRunIds.map((sourceRunId, index) => [sourceRunId, index]),
  );
  const localExpansionSourceRunIds = Array.from(
    new Set([...sourceRunIdsForLocalExpansion(indexedCandidates), ...lexicalEvidenceSourceRunIds]),
  );
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
  const candidates = uniqueFactsById([...indexedCandidates, ...sourceRunCandidates]).filter((fact) =>
    isFactEligibleForRecall(fact, options),
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
      if (added) {
        primaryGroups.add(primarySelectionGroupKey(entry.fact));
        if (entry.fact.memoryKind === 'procedure') selectedPrimaryProcedures += 1;
      }
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

    if (
      primaryLimit > primaryProcedureLimit &&
      selected.length < primaryLimit &&
      selectedPrimaryProcedures < primaryProcedureLimit
    ) {
      const bestStandaloneProcedure = bestStandaloneProcedureCandidate(scored, threshold, () => true);
      if (bestStandaloneProcedure) {
        const added = addSelectedFact({
          selected,
          seenIds,
          seenKeys,
          fact: bestStandaloneProcedure.fact,
          limit: primaryLimit,
        });
        if (added) {
          primaryGroups.add(primarySelectionGroupKey(bestStandaloneProcedure.fact));
          selectedPrimaryProcedures += 1;
        }
      }
    }

    for (const entry of rankSourceCoherentEntries(scored, sourceRunEvidenceRank)) {
      if (entry.relevanceScore < threshold && entry.score < threshold) continue;
      if (
        entry.fact.memoryKind === 'procedure' &&
        selectedPrimaryProcedures >= primaryProcedureLimit
      ) {
        continue;
      }
      const groupKey = primarySelectionGroupKey(entry.fact);
      if (primaryGroups.has(groupKey)) continue;
      let representative = primaryWorkflowRepresentative(entry, scored, threshold) as ScoredFact;
      if (
        representative.fact.id === entry.fact.id &&
        entry.fact.sourceRunId &&
        entry.fact.memoryKind === 'outcome'
      ) {
        const procedure = workflowProcedureRepresentativeForOutcome(
          entry.fact,
          workflowProceduresBySourceRun.get(entry.fact.sourceRunId) ?? [],
        );
        if (procedure) representative = { ...entry, fact: procedure };
      }
      if (
        representative.fact.memoryKind === 'procedure' &&
        selectedPrimaryProcedures >= primaryProcedureLimit
      ) {
        if (entry.fact.memoryKind === 'procedure') continue;
        representative = entry;
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

  if (trimmedQuery && selected.length < limit) {
    const threshold = options.threshold ?? DEFAULT_TEXT_THRESHOLD;
    const selectedActionResultSourceRunIds = selectedActionResultSourceRuns(selected);
    for (const entry of scored) {
      if (entry.relevanceScore < threshold && entry.score < threshold) continue;
      if (
        isActionResultOutcome(entry.fact) &&
        entry.fact.sourceRunId &&
        selectedActionResultSourceRunIds.has(entry.fact.sourceRunId) &&
        !isImmediateActionResultContinuation(entry.fact, selected)
      ) {
        continue;
      }
      addSelectedFact({ selected, seenIds, seenKeys, fact: entry.fact, limit });
      if (selected.length >= limit) break;
    }
  }

  if (trimmedQuery) {
    const selectedProcedureSourceRuns = new Set(
      selected
        .filter((fact) => fact.memoryKind === 'procedure' && fact.sourceRunId)
        .map((fact) => fact.sourceRunId as string),
    );
    const hasActionResultSupportAnchor = selected.some(
      (fact) =>
        isActionResultOutcome(fact) &&
        fact.sourceRunId &&
        !selectedProcedureSourceRuns.has(fact.sourceRunId),
    );
    insertProcedureLocalSupport({
      selected,
      seenIds,
      seenKeys,
      scoredById,
      scored,
      limit,
      procedureSupportBudget: hasActionResultSupportAnchor ? 1 : 0,
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

  if (trimmedQuery) {
    promoteSelectedActionResultContinuations({
      selected,
      seenIds,
      scoredById,
      limit,
      threshold: options.threshold ?? DEFAULT_TEXT_THRESHOLD,
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

  return {
    facts: selected,
    scoredFacts: selected
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
