// ---------------------------------------------------------------------------
// Kavi — Query-time fact recall
// ---------------------------------------------------------------------------
// Bridges the bi-temporal fact store and the prompt assembler. The orchestrator
// hands us the latest user message; we return the top-K facts that should be
// injected into Layer 3 (`<retrieved_memory>` block) of the prompt.
//
// Scoring is deliberately sparse and deterministic:
//   • query-aware candidate generation from indexed lexical units;
//   • candidate-set IDF weighted lexical overlap;
//   • quoted-anchor boosts for exact UI/action names present on the same fact;
//   • context quality only after relevance is established.
//
// Query-time recall does not call embedding providers. The mobile assistant
// should have a predictable local memory read path; separate file/chunk search
// can still use embeddings through its own index.
// All retrieved facts are currently-valid (`invalid_at IS NULL`) by default —
// callers can pass `asOf` for historical queries.
// ---------------------------------------------------------------------------

import { markFactsRecalled } from './facts/mutations';
import {
  listFactsForSourceRunForwardWindows,
  listFactsForRecallCandidates,
  listFactTermUnitHitsForFacts,
  listFactsForSourceRunStateNeighborhoods,
} from './facts/queries';
import { type MemoryFact, type MemoryFactKind, type MemoryFactScope } from './facts/types';
import { countLexicalUnits } from './ranking/lexical';
import { quotedSpanUnitSets } from './ranking/quotedSpans';
import { exponentialDecayMultiplier } from './ranking/scoring';
import {
  compareSupportCandidates,
  primarySelectionGroupKey,
  selectionDedupeKey,
  sourceRunSupportContexts,
  supportDiversityKey,
  supportSlotCount,
} from './ranking/selection';

const DEFAULT_LIMIT = 8;
const DEFAULT_TEXT_THRESHOLD = 0.04;
const PINNED_BOOST = 0.25;
const CANDIDATE_POOL_LIMIT = 128;
const CANDIDATE_POOL_MAX = 2_000;
const RELEVANCE_EPSILON = 1e-6;
const QUOTED_ANCHOR_LIMIT = 12;
const QUOTED_ANCHOR_MATCH_BOOST = 0.18;
const QUOTED_ANCHOR_FULL_MATCH_BOOST = 0.12;
const RECALL_QUERY_UNIT_LIMIT = 96;
const SOURCE_RUN_SUPPORT_FORWARD_RADIUS = 16;
const SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT = 16;
const SOURCE_RUN_SUPPORT_RADIUS = 2;
const SOURCE_RUN_SUPPORT_PER_RUN_LIMIT = 8;

export interface RecallFactsOptions {
  /** Maximum facts returned. Default 8. */
  limit?: number;
  /**
   * Relevance-score floor for inclusion. Scope, reinforcement, importance,
   * retrievability, and recency cannot move zero-relevance facts over this
   * floor; pinned facts are the only explicit non-query anchors.
   */
  threshold?: number;
  /** Bi-temporal anchor — facts valid at this ms timestamp. */
  asOf?: number;
  includeHistorical?: boolean;
  scopeHints?: MemoryFactScope[];
  conversationId?: string;
  taskId?: string;
  memoryKind?: MemoryFactKind | MemoryFactKind[];
  now?: number;
  /**
   * When true (default), pinned facts are always returned regardless of
   * threshold and consume `limit` slots first.
   */
  alwaysIncludePinned?: boolean;
  /**
   * Pool of candidates pulled from the store before scoring. Larger = more
   * recall, slower scoring. Default 128.
   */
  candidatePoolLimit?: number;
  /** Maximum query lexical units used for indexed recall fanout. */
  lexicalUnitLimit?: number;
  /** Optional recall-stage telemetry. Used by product diagnostics and benchmarks. */
  onTiming?: (timing: RecallFactsTiming) => void;
}

export interface RecallFactsTiming {
  queryChars: number;
  queryUnitCount: number;
  candidateCount: number;
  candidateHitFactCount: number;
  tokenizeQueryMs: number;
  candidateFetchMs: number;
  candidateTermHitsMs: number;
  unitWeightsMs: number;
  scoreMs: number;
  sortMs: number;
  selectMs: number;
  totalMs: number;
}

export interface ScoredFact {
  fact: MemoryFact;
  score: number;
  textScore: number;
  lexicalScore: number;
  pinnedBoost: number;
  decayMultiplier: number;
  scopeBoost: number;
  reinforcementBoost: number;
  importanceScore: number;
  retrievabilityScore: number;
  relevanceScore: number;
}

function lexicalOverlapFromUnitHits(
  queryUnits: Set<string>,
  factUnitHits: ReadonlySet<string> | undefined,
  unitWeights?: ReadonlyMap<string, number>,
): number {
  if (queryUnits.size === 0 || !factUnitHits || factUnitHits.size === 0) return 0;
  let hits = 0;
  let total = 0;
  for (const unit of queryUnits) {
    const weight = unitWeights?.get(unit) ?? 1;
    total += weight;
    if (factUnitHits.has(unit)) hits += weight;
  }
  return total > 0 ? hits / total : 0;
}

function buildQueryUnitWeightsFromHits(
  queryUnits: Set<string>,
  candidates: ReadonlyArray<MemoryFact>,
  candidateUnitHits: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, number> {
  const weights = new Map<string, number>();
  if (queryUnits.size === 0 || candidates.length === 0) return weights;
  const documentFrequency = new Map<string, number>();
  for (const candidate of candidates) {
    const hits = candidateUnitHits.get(candidate.id);
    if (!hits || hits.size === 0) continue;
    for (const unit of queryUnits) {
      if (hits.has(unit)) {
        documentFrequency.set(unit, (documentFrequency.get(unit) ?? 0) + 1);
      }
    }
  }
  const documentCount = candidates.length;
  for (const unit of queryUnits) {
    const df = documentFrequency.get(unit) ?? 0;
    weights.set(unit, Math.log((documentCount + 1) / (df + 1)) + 1);
  }
  return weights;
}

function buildRecallLexicalUnits(
  queryUnitCounts: ReadonlyMap<string, number>,
  anchorLexicalUnits: ReadonlyArray<string>,
  lexicalUnitLimit: number | undefined,
): string[] {
  const limit = Math.max(
    1,
    Math.min(lexicalUnitLimit ?? RECALL_QUERY_UNIT_LIMIT, RECALL_QUERY_UNIT_LIMIT),
  );
  const units: string[] = [];
  const seen = new Set<string>();
  const addUnit = (rawUnit: string) => {
    if (units.length >= limit) return;
    const unit = rawUnit.trim();
    if (!unit || seen.has(unit)) return;
    seen.add(unit);
    units.push(unit);
  };

  for (const unit of anchorLexicalUnits) addUnit(unit);
  for (const unit of queryUnitCounts.keys()) addUnit(unit);
  return units;
}

function selectScoringQueryUnits(
  recallLexicalUnits: ReadonlyArray<string>,
  queryUnits: ReadonlySet<string>,
  candidateUnitHits: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const hitUnits = new Set<string>();
  for (const hits of candidateUnitHits.values()) {
    for (const unit of hits) hitUnits.add(unit);
  }
  const scoringUnits = new Set<string>();
  for (const unit of recallLexicalUnits) {
    if (queryUnits.has(unit) && hitUnits.has(unit)) scoringUnits.add(unit);
  }
  if (scoringUnits.size > 0) return scoringUnits;
  for (const unit of recallLexicalUnits) {
    if (queryUnits.has(unit)) scoringUnits.add(unit);
  }
  return scoringUnits;
}

function anchorMatchBoost(
  anchorUnitSets: ReadonlyArray<Set<string>>,
  factUnitHits: ReadonlySet<string> | undefined,
): number {
  if (anchorUnitSets.length === 0) return 0;
  const matched = anchorUnitSets.filter((anchorUnits) => {
    if (anchorUnits.size === 0) return false;
    return Array.from(anchorUnits).every((unit) => factUnitHits?.has(unit));
  }).length;
  if (matched === 0) return 0;
  return (
    matched * QUOTED_ANCHOR_MATCH_BOOST +
    (matched === anchorUnitSets.length ? QUOTED_ANCHOR_FULL_MATCH_BOOST : 0)
  );
}

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

function scoreScope(fact: MemoryFact, options: RecallFactsOptions): number {
  if (fact.scope === 'conversation' && fact.originConversationId === options.conversationId) {
    return 0.08;
  }
  if (fact.scope === 'session' && fact.originTaskId === options.taskId) {
    return 0.08;
  }
  if (options.scopeHints?.includes(fact.scope)) return 0.04;
  return 0;
}

function decayHalfLifeDays(fact: MemoryFact): number {
  if (fact.pinned || fact.decayPolicy === 'pinned') return Number.POSITIVE_INFINITY;
  if (fact.decayPolicy === 'slow') return 180;
  if (fact.decayPolicy === 'fast') return 7;
  if (fact.decayPolicy === 'ephemeral') return 2;
  return 30 + fact.importance * 90 + Math.log1p(fact.accessCount) * 12;
}

function scoreDecay(fact: MemoryFact, now: number): number {
  const halfLifeDays = decayHalfLifeDays(fact);
  if (!Number.isFinite(halfLifeDays)) return 1;
  const lastStrengthAt = fact.lastReinforcedAt ?? fact.lastRecalledAt ?? fact.updatedAt;
  const ageDays = Math.max(0, now - lastStrengthAt) / (24 * 60 * 60 * 1000);
  return exponentialDecayMultiplier({ ageInDays: ageDays, halfLifeDays });
}

function scoreReinforcement(fact: MemoryFact): number {
  return Math.min(0.05, Math.log1p(fact.accessCount + fact.repeatedMentionCount) * 0.015);
}

function scoreRetrievability(fact: MemoryFact): number {
  return Math.max(0, Math.min(1, fact.retrievability));
}

function buildScoredFact(params: {
  fact: MemoryFact;
  queryUnits: Set<string>;
  factUnitHits: ReadonlySet<string> | undefined;
  unitWeights: ReadonlyMap<string, number>;
  anchorUnitSets: ReadonlyArray<Set<string>>;
  alwaysIncludePinned: boolean;
  options: RecallFactsOptions;
  now: number;
}): ScoredFact {
  const {
    fact,
    queryUnits,
    factUnitHits,
    anchorUnitSets,
    alwaysIncludePinned,
    options,
    now,
  } = params;
  const lexicalScore = lexicalOverlapFromUnitHits(queryUnits, factUnitHits, params.unitWeights);
  const textScore = lexicalScore;
  const pinnedBoost = alwaysIncludePinned && fact.pinned ? PINNED_BOOST : 0;
  const decayMultiplier = scoreDecay(fact, now);
  const scopeBoost = scoreScope(fact, options);
  const reinforcementBoost = scoreReinforcement(fact);
  const importanceScore = fact.importance * 0.04;
  const retrievabilityScore = scoreRetrievability(fact);
  const relevanceScore = textScore * fact.confidence * decayMultiplier * retrievabilityScore;
  const anchorBoost = anchorMatchBoost(anchorUnitSets, factUnitHits);
  const hasRelevance = relevanceScore > RELEVANCE_EPSILON;
  const score =
    relevanceScore +
    anchorBoost +
    pinnedBoost +
    (hasRelevance || anchorBoost > 0 ? scopeBoost + reinforcementBoost + importanceScore : 0);
  return {
    fact,
    score,
    textScore,
    lexicalScore,
    pinnedBoost,
    decayMultiplier,
    scopeBoost,
    reinforcementBoost,
    importanceScore,
    retrievabilityScore,
    relevanceScore,
  };
}

function addSelectedFact(params: {
  selected: MemoryFact[];
  seenIds: Set<string>;
  seenKeys: Set<string>;
  fact: MemoryFact;
  limit: number;
}): boolean {
  if (params.selected.length >= params.limit) return false;
  if (params.seenIds.has(params.fact.id)) return false;
  const key = selectionDedupeKey(params.fact);
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
  const candidates = listFactsForRecallCandidates({
    limit: candidatePool,
    selectedLexicalUnits: recallLexicalUnits,
    ...(options.conversationId ? { scopedRecentConversationId: options.conversationId } : {}),
    ...(options.taskId ? { scopedRecentTaskId: options.taskId } : {}),
    ...(candidateScopes ? { scope: candidateScopes } : {}),
    ...(options.memoryKind ? { memoryKind: options.memoryKind } : {}),
    ...(options.includeHistorical ? { includeInvalidated: true } : {}),
    ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
  }).filter((fact) => isFactEligibleForRecall(fact, options));
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
  const unitWeights = buildQueryUnitWeightsFromHits(scoringQueryUnits, candidates, candidateUnitHits);
  timing.unitWeightsMs = Date.now() - unitWeightsStarted;

  const scoreStarted = Date.now();
  const scored = candidates.map((fact) =>
    buildScoredFact({
      fact,
      queryUnits: scoringQueryUnits,
      factUnitHits: candidateUnitHits.get(fact.id),
      unitWeights,
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
    for (const entry of scored) {
      if (entry.relevanceScore < threshold && entry.score < threshold) continue;
      const groupKey = primarySelectionGroupKey(entry.fact);
      if (primaryGroups.has(groupKey)) continue;
      const added = addSelectedFact({
        selected,
        seenIds,
        seenKeys,
        fact: entry.fact,
        limit: primaryLimit,
      });
      if (added) primaryGroups.add(groupKey);
      if (selected.length >= primaryLimit) break;
    }
  }

  if (trimmedQuery && selected.length < limit && reservedSupportSlots > 0) {
    const supportContexts = sourceRunSupportContexts(selected, scored);
    const selectedSourceRuns = Array.from(
      new Set(selected.map((fact) => fact.sourceRunId).filter(Boolean) as string[]),
    );
    const supportLimit = Math.min(limit, selected.length + reservedSupportSlots);
    const supportFactsById = new Map<string, MemoryFact>();
    const forwardFacts = listFactsForSourceRunForwardWindows(supportContexts, {
      memoryKind: ['ui_inventory', 'ui_field', 'ui_filter_state', 'outcome'],
      forwardRadius: SOURCE_RUN_SUPPORT_FORWARD_RADIUS,
      stateLimit: SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT,
      limit: selectedSourceRuns.length * SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT,
      ...(candidateScopes ? { scope: candidateScopes } : {}),
      ...(options.conversationId ? { originConversationId: options.conversationId } : {}),
      ...(options.taskId ? { originTaskId: options.taskId } : {}),
      ...(options.includeHistorical ? { includeInvalidated: true } : {}),
      ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
    });
    for (const fact of forwardFacts) {
      if (seenIds.has(fact.id) || !fact.sourceRunId || !selectedSourceRuns.includes(fact.sourceRunId)) {
        continue;
      }
      supportFactsById.set(fact.id, fact);
    }
    for (const sourceRunId of selectedSourceRuns) {
      const contextsForRun = supportContexts.filter((context) => context.sourceRunId === sourceRunId);
      if (contextsForRun.length === 0) continue;
      const supportFacts = listFactsForSourceRunStateNeighborhoods(contextsForRun, {
        memoryKind: ['ui_inventory', 'ui_field', 'ui_filter_state', 'outcome'],
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
    const supportFacts = Array.from(supportFactsById.values());
    const supportUnitHits = listFactTermUnitHitsForFacts(
      supportFacts.map((fact) => fact.id),
      recallLexicalUnits,
    );
    const sourceRunSupportRank = new Map(
      selectedSourceRuns.map((sourceRunId, index) => [sourceRunId, index]),
    );
    const seenSupportDiversityKeys = new Set(
      selected.map((fact) => supportDiversityKey(fact)).filter(Boolean),
    );
    const supportEntries = supportFacts
      .map((fact) => ({
        fact,
        scored: buildScoredFact({
          fact,
          queryUnits: scoringQueryUnits,
          factUnitHits: supportUnitHits.get(fact.id),
          unitWeights,
          anchorUnitSets,
          alwaysIncludePinned,
          options,
          now,
        }),
      }))
      .sort((left, right) => {
        const leftRank = sourceRunSupportRank.get(left.fact.sourceRunId ?? '') ?? Number.MAX_SAFE_INTEGER;
        const rightRank = sourceRunSupportRank.get(right.fact.sourceRunId ?? '') ?? Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return compareSupportCandidates(left, right);
      });
    for (const entry of supportEntries) {
      const diversityKey = supportDiversityKey(entry.fact);
      if (diversityKey && seenSupportDiversityKeys.has(diversityKey)) continue;
      const added = addSelectedFact({
        selected,
        seenIds,
        seenKeys,
        fact: entry.fact,
        limit: supportLimit,
      });
      if (added) {
        if (diversityKey) seenSupportDiversityKeys.add(diversityKey);
        scoredById.set(entry.fact.id, entry.scored);
      }
      if (selected.length >= supportLimit) break;
    }
  }

  if (trimmedQuery && selected.length < limit) {
    const threshold = options.threshold ?? DEFAULT_TEXT_THRESHOLD;
    for (const entry of scored) {
      if (entry.relevanceScore < threshold && entry.score < threshold) continue;
      addSelectedFact({ selected, seenIds, seenKeys, fact: entry.fact, limit });
      if (selected.length >= limit) break;
    }
  }

  timing.selectMs = Date.now() - selectStarted;
  timing.totalMs = Date.now() - totalStarted;
  options.onTiming?.(timing);

  return {
    facts: selected,
    scoredFacts: selected.map((fact) => scoredById.get(fact.id)).filter(Boolean) as ScoredFact[],
  };
}

/**
 * Query-time recall — the canonical entry point used by prompt assembly.
 *
 * Returns up to `limit` MemoryFact entries ranked by combined score. Pinned
 * facts are always included (consuming slots first) when
 * `alwaysIncludePinned` is true (default).
 *
 * The function is deliberately tolerant of partial inputs: empty queries
 * return only pinned facts.
 */
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

/**
 * Score-bearing variant. Same selection logic as `recallFactsForQuery` but
 * returns the per-fact scoring breakdown so callers (telemetry, UI) can show
 * why a fact was retrieved.
 */
export async function recallScoredFactsForQuery(
  query: string,
  options: RecallFactsOptions = {},
): Promise<ScoredFact[]> {
  const selection = await buildRecallSelection(query, options);
  return selection.scoredFacts;
}
