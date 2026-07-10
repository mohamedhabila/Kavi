// Kavi query-time fact recall. This path is deterministic and local: fuse a
// bounded set of already-eligible lexical, entity, temporal, and compatible
// local-similarity candidates, score it once, and return the best memories.
// Agent-run structure belongs in compact memory records, not query-time repair.

import {
  listFactTermUnitHitsForFacts,
  listFactsForRecallEligibleScan,
  listFactsForRecallCandidates,
} from './facts/queries';
import { type MemoryFact, type MemoryFactScope } from './facts/types';
import { getEntitiesByIds } from './entities';
import { selectIndexedRecallLexicalUnits } from './factRecallCandidateUnits';
import { RECALL_CANDIDATE_LIMITS } from './factRecallCandidateContract';
import { recallCandidateDiversityKey } from './factRecallCandidateUnion';
import { extractTemporalRecallYears } from './factRecallCandidateLanes';
import { buildRecallCandidateSet } from './factRecallHybridCandidates';
import { buildRecallLexicalUnits, selectScoringQueryUnits } from './factRecallQueryUnits';
import {
  type RecallFactsOptions,
  type RecallFactsTiming,
  type ScoredFact,
} from './factRecallTypes';
import { buildQueryUnitWeightsFromHits, buildScoredFact } from './factRecallScoring';
import { countLexicalUnits } from './ranking/lexical';
import { quotedSpanUnitSets } from './ranking/quotedSpans';
import {
  canFactEnterRecallCandidates,
  requireFactRecallAccessContext,
  type FactRecallAccessContext,
} from './factRecallAccessPolicy';

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
const DEFAULT_RESOLUTION_CANDIDATE_LIMIT = 14;
const MAX_RESOLUTION_CANDIDATE_LIMIT = 14;

export interface RecallFactSelection {
  facts: MemoryFact[];
  resolutionFacts: MemoryFact[];
  scoredFacts: ScoredFact[];
}

function normalizePositiveIntegerLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const requested = value === undefined || !Number.isFinite(value) ? fallback : Math.floor(value);
  return Math.max(1, Math.min(requested, maximum));
}

function getCandidateScopes(options: RecallFactsOptions): MemoryFactScope[] | undefined {
  if (options.scopeFilter) {
    return Array.isArray(options.scopeFilter) ? options.scopeFilter : [options.scopeFilter];
  }
  if (!options.scopeHints?.length && !options.memoryScope) {
    return undefined;
  }
  const scopes = new Set<MemoryFactScope>(options.scopeHints ?? []);
  scopes.add('conversation');
  scopes.add('session');
  scopes.add('persona');
  scopes.add('global');
  scopes.add('project');
  return scopes.size > 0 ? Array.from(scopes) : undefined;
}

function isFactEligibleForRecall(
  fact: MemoryFact,
  accessContext: FactRecallAccessContext,
  lane: 'direct_use' | 'resolution',
): boolean {
  return canFactEnterRecallCandidates(fact, accessContext, lane);
}

function uniqueFactsById(facts: ReadonlyArray<MemoryFact>): MemoryFact[] {
  const byId = new Map<string, MemoryFact>();
  for (const fact of facts) byId.set(fact.id, fact);
  return Array.from(byId.values());
}

function factDedupeKey(fact: MemoryFact): string {
  return `${fact.memoryKind}\u0000${fact.contentHash || fact.objectText.trim()}`;
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

  const requestedSelectorCandidateLimit = normalizePositiveIntegerLimit(
    params.options.selectorCandidateLimit,
    DEFAULT_SELECTOR_CANDIDATE_LIMIT,
    Math.max(1, params.scored.length),
  );
  const selectorCandidateLimit = Math.max(
    params.limit,
    Math.min(requestedSelectorCandidateLimit, params.scored.length),
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
  const seenDiversityKeys = new Set<string>();
  const appendSelected = (entry: ScoredFact, requireNewDiversityKey = false): boolean => {
    if (selected.length >= params.limit) return false;
    if (seenIds.has(entry.fact.id)) return false;
    const diversityKey = recallCandidateDiversityKey(entry.fact);
    if (requireNewDiversityKey && seenDiversityKeys.has(diversityKey)) return false;
    const key = factDedupeKey(entry.fact);
    if (seenKeys.has(key)) return false;
    selected.push(entry);
    seenIds.add(entry.fact.id);
    seenKeys.add(key);
    seenDiversityKeys.add(diversityKey);
    return true;
  };
  for (const entry of protectedSelected) appendSelected(entry);

  let semanticSelectedCount = 0;
  let semanticAdmittedCount = 0;
  const semanticSelectedEntries: ScoredFact[] = [];
  const selectorStarted = Date.now();
  try {
    const result = await selector({
      query: params.query,
      limit: params.limit,
      candidates,
    });
    for (const factId of result.factIds) {
      const entry = byId.get(factId);
      if (!entry) continue;
      semanticSelectedCount += 1;
      semanticSelectedEntries.push(entry);
    }
    for (const entry of semanticSelectedEntries) {
      if (appendSelected(entry, true)) semanticAdmittedCount += 1;
    }
    for (const entry of semanticSelectedEntries) {
      if (appendSelected(entry)) semanticAdmittedCount += 1;
    }
  } catch {
    params.timing.selectorSelectedCount = 0;
    params.timing.selectorApplied = false;
    return [...params.deterministicSelected];
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
    const diversityKey = recallCandidateDiversityKey(entry.fact);
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
): Promise<RecallFactSelection> {
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
  const limit = normalizePositiveIntegerLimit(options.limit, DEFAULT_LIMIT, 50);
  const requestedCandidatePool = normalizePositiveIntegerLimit(
    options.candidatePoolLimit,
    CANDIDATE_POOL_LIMIT,
    CANDIDATE_POOL_MAX,
  );
  const candidatePool = Math.max(limit, requestedCandidatePool);
  const resolutionCandidateLimit = normalizePositiveIntegerLimit(
    options.resolutionCandidateLimit,
    DEFAULT_RESOLUTION_CANDIDATE_LIMIT,
    MAX_RESOLUTION_CANDIDATE_LIMIT,
  );
  const alwaysIncludePinned = options.alwaysIncludePinned !== false;
  const trimmedQuery = query.trim();
  if (options.now !== undefined && options.asOf !== undefined && options.now !== options.asOf) {
    throw new Error('memory_recall_access_timestamp_mismatch');
  }
  const now = options.asOf ?? options.now ?? Date.now();
  const accessContext = requireFactRecallAccessContext({
    memoryScope: options.memoryScope,
    useIntent: options.useIntent,
    asOf: now,
  });
  const candidateScopes = getCandidateScopes(options);
  const candidateStrategy = options.candidateStrategy ?? 'hybrid';
  const directRecallScopeIdentity = {
    ...accessContext.scope,
    useIntent: accessContext.useIntent,
    candidateLane: 'direct_use' as const,
  };
  const resolutionRecallScopeIdentity = {
    ...accessContext.scope,
    useIntent: accessContext.useIntent,
    candidateLane: 'resolution' as const,
  };
  const eligibleScanLimit = normalizePositiveIntegerLimit(
    options.eligibleScanLimit,
    RECALL_CANDIDATE_LIMITS.defaultEligibleScan,
    RECALL_CANDIDATE_LIMITS.maximumEligibleScan,
  );

  const tokenizeStarted = Date.now();
  const queryUnitCounts = countLexicalUnits(trimmedQuery);
  const queryUnits = new Set(queryUnitCounts.keys());
  const explicitTemporalSignal = extractTemporalRecallYears(trimmedQuery).size > 0;
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
  const lexicalCandidates = uniqueFactsById(
    listFactsForRecallCandidates({
      limit: candidatePool,
      recallScopeIdentity: directRecallScopeIdentity,
      selectedLexicalUnits: indexedRecallLexicalUnits,
      scopedRecentConversationId: accessContext.scope.memoryConversationId,
      ...(accessContext.scope.taskId ? { scopedRecentTaskId: accessContext.scope.taskId } : {}),
      ...(candidateScopes ? { scope: candidateScopes } : {}),
      ...(options.memoryKind ? { memoryKind: options.memoryKind } : {}),
      asOf: now,
      anchorLexicalUnitSets: anchorUnitSets.map((anchorUnits) => Array.from(anchorUnits)),
    }),
  ).filter((fact) => isFactEligibleForRecall(fact, accessContext, 'direct_use'));
  const eligibleFacts =
    candidateStrategy === 'hybrid' && trimmedQuery
      ? listFactsForRecallEligibleScan({
          limit: eligibleScanLimit,
          recallScopeIdentity: directRecallScopeIdentity,
          ...(candidateScopes ? { scope: candidateScopes } : {}),
          ...(options.memoryKind ? { memoryKind: options.memoryKind } : {}),
          asOf: now,
        }).filter((fact) => isFactEligibleForRecall(fact, accessContext, 'direct_use'))
      : [];
  const resolutionFetchStarted = Date.now();
  const resolutionFacts =
    trimmedQuery && indexedRecallLexicalUnits.length > 0
      ? uniqueFactsById(
          listFactsForRecallCandidates({
            limit: resolutionCandidateLimit,
            recallScopeIdentity: resolutionRecallScopeIdentity,
            selectedLexicalUnits: indexedRecallLexicalUnits,
            includePinnedCandidates: false,
            includeUnanchoredCandidates: false,
            ...(candidateScopes ? { scope: candidateScopes } : {}),
            ...(options.memoryKind ? { memoryKind: options.memoryKind } : {}),
            asOf: now,
            anchorLexicalUnitSets: anchorUnitSets.map((units) => Array.from(units)),
          }),
        ).filter((fact) => isFactEligibleForRecall(fact, accessContext, 'resolution'))
      : [];
  timing.resolutionCandidateFetchMs = Date.now() - resolutionFetchStarted;
  timing.resolutionCandidateCount = resolutionFacts.length;
  const entities =
    eligibleFacts.length > 0
      ? getEntitiesByIds(
          eligibleFacts.flatMap((fact) =>
            fact.objectEntityId ? [fact.subjectId, fact.objectEntityId] : [fact.subjectId],
          ),
        )
      : [];
  timing.candidateFetchMs = Date.now() - candidateFetchStarted;

  const candidateTermHitsStarted = Date.now();
  const allCandidateUnitHits = listFactTermUnitHitsForFacts(
    uniqueFactsById([...lexicalCandidates, ...eligibleFacts]).map((fact) => fact.id),
    recallLexicalUnits,
  );
  const candidateSet = buildRecallCandidateSet({
    strategy: candidateStrategy,
    query: trimmedQuery,
    queryUnits,
    anchorUnitSets,
    lexicalCandidates,
    candidateUnitHits: allCandidateUnitHits,
    eligibleFacts,
    entities,
    ...(options.localSimilarity ? { localSimilarity: options.localSimilarity } : {}),
    limit: candidatePool,
  });
  const candidates = candidateSet.candidates;
  const candidateIds = new Set(candidates.map((fact) => fact.id));
  const candidateUnitHits = new Map(
    Array.from(allCandidateUnitHits).filter(([factId]) => candidateIds.has(factId)),
  );
  timing.candidateTermHitsMs = Date.now() - candidateTermHitsStarted;
  timing.candidateCount = candidates.length;
  timing.candidateHitFactCount = candidateUnitHits.size;
  timing.candidateStages = candidateSet.telemetry;
  const scoringQueryUnits = selectScoringQueryUnits(
    recallLexicalUnits,
    queryUnits,
    candidateUnitHits,
  );

  const unitWeightsStarted = Date.now();
  const unitWeights = buildQueryUnitWeightsFromHits(
    scoringQueryUnits,
    candidates,
    candidateUnitHits,
  );
  timing.unitWeightsMs = Date.now() - unitWeightsStarted;

  const scoreStarted = Date.now();
  const scored = candidates.map((fact) =>
    buildScoredFact({
      fact,
      queryUnits: scoringQueryUnits,
      factUnitHits: candidateUnitHits.get(fact.id),
      unitWeights,
      query: trimmedQuery,
      anchorUnitSets,
      candidateProvenance: candidateSet.provenanceByFactId.get(fact.id),
      explicitTemporalSignal,
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
    scoringUnits: scoringQueryUnits,
    options,
    limit,
    timing,
  });
  timing.selectMs = Date.now() - selectStarted;
  timing.totalMs = Date.now() - totalStarted;
  options.onTiming?.(timing);

  return {
    facts: selected.map((entry) => entry.fact),
    resolutionFacts,
    scoredFacts: selected,
  };
}

export async function recallFactSelectionForQuery(
  query: string,
  options: RecallFactsOptions,
): Promise<RecallFactSelection> {
  return buildRecallSelection(query, options);
}

export async function recallFactsForQuery(
  query: string,
  options: RecallFactsOptions,
): Promise<MemoryFact[]> {
  const selection = await buildRecallSelection(query, options);
  return selection.facts;
}

export async function recallScoredFactsForQuery(
  query: string,
  options: RecallFactsOptions,
): Promise<ScoredFact[]> {
  const selection = await buildRecallSelection(query, options);
  return selection.scoredFacts;
}
