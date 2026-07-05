// Kavi query-time fact recall. This path is deterministic and local: build one
// indexed lexical candidate pool, score it once, and return the best matching
// memories. Agent-run structure belongs in compact memory records, not in
// query-time repair lanes.

import { markFactsRecalled } from './facts/mutations';
import { listFactTermUnitHitsForFacts, listFactsForRecallCandidates } from './facts/queries';
import { type MemoryFact, type MemoryFactScope } from './facts/types';
import { selectIndexedRecallLexicalUnits } from './factRecallCandidateUnits';
import { buildRecallLexicalUnits, selectScoringQueryUnits } from './factRecallQueryUnits';
import {
  type RecallFactsOptions,
  type RecallFactsTiming,
  type ScoredFact,
} from './factRecallTypes';
import {
  buildQueryUnitWeightsFromHits,
  buildScoredFact,
  selectDiscriminativeScoringUnits,
} from './factRecallScoring';
import { countLexicalUnits } from './ranking/lexical';
import { quotedSpanUnitSets } from './ranking/quotedSpans';

export type {
  MemoryFactSelector,
  RecallFactsOptions,
  RecallFactsTiming,
  ScoredFact,
} from './factRecallTypes';

const DEFAULT_LIMIT = 8;
const DEFAULT_TEXT_THRESHOLD = 0.04;
const CANDIDATE_POOL_LIMIT = 128;
const CANDIDATE_POOL_MAX = 2_000;
const QUOTED_ANCHOR_LIMIT = 12;
const DEFAULT_SELECTOR_CANDIDATE_LIMIT = 48;

function selectorTargetCount(candidateCount: number, limit: number): number {
  if (candidateCount <= 0) return 0;
  return Math.max(1, Math.min(candidateCount, limit));
}

function getCandidateScopes(options: RecallFactsOptions): MemoryFactScope[] | undefined {
  if (options.scopeFilter) {
    return Array.isArray(options.scopeFilter) ? options.scopeFilter : [options.scopeFilter];
  }
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

function factDedupeKey(fact: MemoryFact): string {
  return `${fact.memoryKind}\u0000${fact.contentHash || fact.objectText.trim()}`;
}

function selectorDiversityKey(fact: MemoryFact): string {
  const sourceRunId = fact.sourceRunId?.trim();
  if (sourceRunId) return `run:${sourceRunId}`;
  const taskId = fact.originTaskId?.trim() || fact.taskId?.trim();
  if (taskId) return `task:${taskId}`;
  const turnId = fact.sourceTurnId?.trim();
  if (turnId) return `turn:${turnId}`;
  const conversationId = fact.originConversationId?.trim() || fact.originThreadId?.trim();
  if (conversationId) {
    return `conversation:${conversationId}:${fact.memoryKind}:${fact.subjectId}:${fact.predicate}`;
  }
  return `fact:${fact.memoryKind}:${fact.subjectId}:${fact.predicate}`;
}

function selectTopFacts(
  scored: ReadonlyArray<ScoredFact>,
  options: RecallFactsOptions,
  limit: number,
): ScoredFact[] {
  const threshold = options.threshold ?? DEFAULT_TEXT_THRESHOLD;
  const alwaysIncludePinned = options.alwaysIncludePinned !== false;
  const selected: ScoredFact[] = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();

  for (const entry of scored) {
    if (selected.length >= limit) break;
    const isPinned = alwaysIncludePinned && entry.fact.pinned;
    if (!isPinned && entry.relevanceScore < threshold && entry.score < threshold) continue;
    if (seenIds.has(entry.fact.id)) continue;
    const key = factDedupeKey(entry.fact);
    if (seenKeys.has(key)) continue;
    selected.push(entry);
    seenIds.add(entry.fact.id);
    seenKeys.add(key);
  }

  return selected;
}

async function selectFactsWithSemanticSelector(params: {
  query: string;
  scored: ReadonlyArray<ScoredFact>;
  deterministicSelected: ReadonlyArray<ScoredFact>;
  candidateUnitHits: ReadonlyMap<string, ReadonlySet<string>>;
  unitWeights: ReadonlyMap<string, number>;
  scoringUnits: ReadonlySet<string>;
  options: RecallFactsOptions;
  limit: number;
  timing: RecallFactsTiming;
}): Promise<ScoredFact[]> {
  const selector = params.options.selector;
  if (!selector) return [...params.deterministicSelected];

  const selectorCandidateLimit = Math.max(
    params.limit,
    Math.min(
      params.options.selectorCandidateLimit ?? DEFAULT_SELECTOR_CANDIDATE_LIMIT,
      params.scored.length,
    ),
  );
  const candidates = selectSelectorCandidates({
    scored: params.scored,
    candidateUnitHits: params.candidateUnitHits,
    unitWeights: params.unitWeights,
    scoringUnits: params.scoringUnits,
    limit: selectorCandidateLimit,
  });
  params.timing.selectorCandidateCount = candidates.length;
  const byId = new Map(candidates.map((entry) => [entry.fact.id, entry]));
  const protectedSelected = params.deterministicSelected.filter((entry) => entry.fact.pinned);
  const selected: ScoredFact[] = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const appendSelected = (entry: ScoredFact): boolean => {
    if (selected.length >= params.limit) return false;
    if (seenIds.has(entry.fact.id)) return false;
    const key = factDedupeKey(entry.fact);
    if (seenKeys.has(key)) return false;
    selected.push(entry);
    seenIds.add(entry.fact.id);
    seenKeys.add(key);
    return true;
  };
  for (const entry of protectedSelected) appendSelected(entry);

  let semanticSelectedCount = 0;
  let semanticAdmittedCount = 0;
  const selectorStarted = Date.now();
  try {
    const result = await selector({
      query: params.query,
      limit: params.limit,
      targetCount: selectorTargetCount(candidates.length, params.limit),
      candidates,
    });
    for (const factId of result.factIds) {
      const entry = byId.get(factId);
      if (!entry) continue;
      semanticSelectedCount += 1;
      if (appendSelected(entry)) semanticAdmittedCount += 1;
    }
  } finally {
    params.timing.selectorMs = Date.now() - selectorStarted;
  }

  if (semanticAdmittedCount === 0) {
    params.timing.selectorSelectedCount = semanticSelectedCount;
    params.timing.selectorApplied = false;
    return [...params.deterministicSelected];
  }

  params.timing.selectorSelectedCount = semanticSelectedCount;
  params.timing.selectorApplied = true;
  return selected;
}

function selectSelectorCandidates(params: {
  scored: ReadonlyArray<ScoredFact>;
  candidateUnitHits: ReadonlyMap<string, ReadonlySet<string>>;
  unitWeights: ReadonlyMap<string, number>;
  scoringUnits: ReadonlySet<string>;
  limit: number;
}): ScoredFact[] {
  const selected = new Map<string, ScoredFact>();
  const selectedDiversityKeys = new Set<string>();
  const firstStageRank = new Map(params.scored.map((entry, index) => [entry.fact.id, index]));
  const append = (entry: ScoredFact | undefined, requireNewDiversityKey = false): boolean => {
    if (!entry || selected.size >= params.limit || selected.has(entry.fact.id)) return false;
    const diversityKey = selectorDiversityKey(entry.fact);
    if (requireNewDiversityKey && selectedDiversityKeys.has(diversityKey)) return false;
    selected.set(entry.fact.id, entry);
    selectedDiversityKeys.add(diversityKey);
    return true;
  };

  const rankedUnits = Array.from(params.scoringUnits)
    .map((unit) => ({ unit, weight: params.unitWeights.get(unit) ?? 1 }))
    .sort((left, right) => {
      if (right.weight !== left.weight) return right.weight - left.weight;
      return left.unit.localeCompare(right.unit);
    });

  for (const { unit } of rankedUnits) {
    const matchingEntries = params.scored.filter((entry) =>
      params.candidateUnitHits.get(entry.fact.id)?.has(unit),
    );
    if (!matchingEntries.some((entry) => append(entry, true))) {
      append(matchingEntries[0]);
    }
    if (selected.size >= params.limit) break;
  }
  for (const entry of params.scored) {
    append(entry, true);
    if (selected.size >= params.limit) break;
  }
  for (const entry of params.scored) {
    append(entry);
    if (selected.size >= params.limit) break;
  }

  return Array.from(selected.values()).sort(
    (left, right) =>
      (firstStageRank.get(left.fact.id) ?? Number.MAX_SAFE_INTEGER) -
      (firstStageRank.get(right.fact.id) ?? Number.MAX_SAFE_INTEGER),
  );
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
  const candidates = uniqueFactsById(
    listFactsForRecallCandidates({
      limit: candidatePool,
      selectedLexicalUnits: indexedRecallLexicalUnits,
      ...(options.conversationId ? { scopedRecentConversationId: options.conversationId } : {}),
      ...(options.taskId ? { scopedRecentTaskId: options.taskId } : {}),
      ...(candidateScopes ? { scope: candidateScopes } : {}),
      ...(options.memoryKind ? { memoryKind: options.memoryKind } : {}),
      ...(options.includeHistorical ? { includeInvalidated: true } : {}),
      ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
      anchorLexicalUnitSets: anchorUnitSets.map((anchorUnits) => Array.from(anchorUnits)),
    }),
  ).filter((fact) => isFactEligibleForRecall(fact, options));
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

  const selectStarted = Date.now();
  const deterministicSelected = selectTopFacts(scored, options, limit);
  const selected = await selectFactsWithSemanticSelector({
    query: trimmedQuery,
    scored,
    deterministicSelected,
    candidateUnitHits,
    unitWeights,
    scoringUnits: discriminativeScoringUnits,
    options,
    limit,
    timing,
  });
  timing.selectMs = Date.now() - selectStarted;
  timing.totalMs = Date.now() - totalStarted;
  options.onTiming?.(timing);

  return {
    facts: selected.map((entry) => entry.fact),
    scoredFacts: selected,
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
