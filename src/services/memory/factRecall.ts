// ---------------------------------------------------------------------------
// Kavi — Query-time fact recall
// ---------------------------------------------------------------------------
// Bridges the bi-temporal fact store and the prompt assembler. The orchestrator
// hands us the latest user message; we return the top-K facts that should be
// injected into Layer 3 (`<retrieved_memory>` block) of the prompt.
//
// Scoring is hybrid:
//   • Vector similarity   — cosine between query embedding and fact embedding
//                           when both are present. Weight: vectorWeight (0.6).
//   • Lexical overlap     — candidate-set IDF weighted fraction of query
//                           lexical units appearing in
//                           "<subject> <predicate> <objectText>". Weight:
//                           textWeight (0.4).
//   • Context quality     — scope, reinforcement, importance, retrievability,
//                           and recency adjust facts only after relevance is
//                           established. Pinned facts remain explicit anchors.
//
// The function never throws; embedding failures degrade to text scoring.
// The default app path uses indexed sparse retrieval. When a caller supplies
// the local Unicode n-gram provider, local embeddings are attached transiently
// for reranking; durable embedding writes belong to explicit background
// backfill, not the user-turn read path.
// All retrieved facts are currently-valid (`invalid_at IS NULL`) by default —
// callers can pass `asOf` for historical queries.
// ---------------------------------------------------------------------------

import type { EmbeddingConfig } from '../../types/memory';
import { getEmbeddingCached, isLocalEmbeddingConfig } from './embeddings';
import { markFactsRecalled, setFactEmbedding } from './facts/mutations';
import {
  listFactsForRecallCandidates,
  listFactTermUnitHitsForFacts,
  listUiInventoriesForObservationContexts,
  selectIndexedLexicalUnitsForRecall,
} from './facts/queries';
import { type MemoryFact, type MemoryFactKind, type MemoryFactScope } from './facts/types';
import { countLexicalUnits } from './ranking/lexical';
import { retrievalTextForFact } from './ranking/factText';
import { factSemanticKey } from './ranking/factSemanticKey';
import { buildScoringLexicalUnits } from './ranking/queryUnits';
import { cosineSimilarity } from './ranking/similarity';
import { exponentialDecayMultiplier } from './ranking/scoring';
import { diversifyTrajectoryAware } from './ranking/trajectoryDiversification';

const DEFAULT_LIMIT = 8;
const DEFAULT_VECTOR_THRESHOLD = 0.08;
const DEFAULT_TEXT_THRESHOLD = 0.04;
const DEFAULT_VECTOR_WEIGHT = 0.6;
const DEFAULT_TEXT_WEIGHT = 0.4;
const DEFAULT_LOCAL_VECTOR_WEIGHT = 0.2;
const DEFAULT_LOCAL_TEXT_WEIGHT = 0.8;
const PINNED_BOOST = 0.25;
const CANDIDATE_POOL_LIMIT = 128;
const CANDIDATE_POOL_MAX = 2_000;
const LOCAL_QUERY_EMBEDDING_ATTACH_LIMIT = 128;
const RELEVANCE_EPSILON = 1e-6;
const TRAJECTORY_NEIGHBOR_LIMIT = 4;
const UI_OBSERVATION_CONTEXT_EXPANSION_LIMIT = 32;

export interface RecallFactsOptions {
  /**
   * If supplied, the query is embedded and vector similarity is added to the
   * score. When omitted, scoring falls back to lexical overlap only.
   */
  embeddingConfig?: EmbeddingConfig;
  /** Maximum facts returned. Default 8. */
  limit?: number;
  /**
   * Relevance-score floor for inclusion. Scope, reinforcement, importance,
   * retrievability, and recency cannot move zero-relevance facts over this
   * floor; pinned facts are the only explicit non-query anchors.
   */
  threshold?: number;
  /** Vector-component weight. Default 0.6. Set to 0 to disable vectors. */
  vectorWeight?: number;
  /** Text-component weight. Default 0.4. Set to 0 to disable lexical match. */
  textWeight?: number;
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
  /**
   * Maximum indexed lexical units used to fetch candidates. Lower values favor
   * rare discriminative units and bound SQLite fanout.
   */
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
  candidateBaseFetchMs: number;
  observationExpansionMs: number;
  candidateTermHitsMs: number;
  localEmbeddingsMs: number;
  unitWeightsMs: number;
  queryEmbeddingMs: number;
  scoreMs: number;
  sortMs: number;
  diversifyMs: number;
  selectMs: number;
  totalMs: number;
}

export interface ScoredFact {
  fact: MemoryFact;
  score: number;
  vectorScore: number;
  textScore: number;
  pinnedBoost: number;
  decayMultiplier: number;
  scopeBoost: number;
  reinforcementBoost: number;
  importanceScore: number;
  retrievabilityScore: number;
  relevanceScore: number;
}

function factHaystack(fact: MemoryFact): string {
  return retrievalTextForFact(fact);
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

function diversifyScoredFacts(
  scored: ScoredFact[],
  limit: number,
  candidateUnitHits: ReadonlyMap<string, Set<string>>,
): ScoredFact[] {
  return diversifyTrajectoryAware(scored, limit, {
    textForFact: factHaystack,
    unitsForFact: (fact) => candidateUnitHits.get(fact.id),
    relevanceEpsilon: RELEVANCE_EPSILON,
    trajectoryNeighborLimit: TRAJECTORY_NEIGHBOR_LIMIT,
  });
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
  queryEmbedding: number[] | null;
  factUnitHits: ReadonlySet<string> | undefined;
  sourceUnitHits: ReadonlySet<string> | undefined;
  vectorWeight: number;
  textWeight: number;
  unitWeights: ReadonlyMap<string, number>;
  alwaysIncludePinned: boolean;
  options: RecallFactsOptions;
  now: number;
}): ScoredFact {
  const {
    fact,
    queryUnits,
    queryEmbedding,
    factUnitHits,
    sourceUnitHits,
    vectorWeight,
    textWeight,
    alwaysIncludePinned,
    options,
    now,
  } = params;
  const textScore =
    textWeight > 0
      ? Math.max(
          lexicalOverlapFromUnitHits(queryUnits, factUnitHits, params.unitWeights),
          lexicalOverlapFromUnitHits(queryUnits, sourceUnitHits, params.unitWeights) * 0.72,
        )
      : 0;
  const vectorScore =
    queryEmbedding && fact.embedding && fact.embedding.length > 0 && vectorWeight > 0
      ? Math.max(0, cosineSimilarity(queryEmbedding, fact.embedding))
      : 0;
  const pinnedBoost = alwaysIncludePinned && fact.pinned ? PINNED_BOOST : 0;
  const decayMultiplier = scoreDecay(fact, now);
  const scopeBoost = scoreScope(fact, options);
  const reinforcementBoost = scoreReinforcement(fact);
  const importanceScore = fact.importance * 0.04;
  const retrievabilityScore = scoreRetrievability(fact);
  const retrievalScore = vectorWeight * vectorScore + textWeight * textScore;
  const relevanceScore = retrievalScore * fact.confidence * decayMultiplier * retrievabilityScore;
  const hasRelevance = relevanceScore > RELEVANCE_EPSILON;
  const score =
    relevanceScore +
    pinnedBoost +
    (hasRelevance ? scopeBoost + reinforcementBoost + importanceScore : 0);
  return {
    fact,
    score,
    vectorScore,
    textScore,
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
  seenSemanticKeys: Set<string>;
  fact: MemoryFact;
  limit: number;
}): boolean {
  if (params.selected.length >= params.limit) return false;
  if (params.seenIds.has(params.fact.id)) return false;
  const semanticKey = factSemanticKey(params.fact);
  if (params.seenSemanticKeys.has(semanticKey)) return false;
  params.selected.push(params.fact);
  params.seenIds.add(params.fact.id);
  params.seenSemanticKeys.add(semanticKey);
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
    candidateBaseFetchMs: 0,
    observationExpansionMs: 0,
    candidateTermHitsMs: 0,
    localEmbeddingsMs: 0,
    unitWeightsMs: 0,
    queryEmbeddingMs: 0,
    scoreMs: 0,
    sortMs: 0,
    diversifyMs: 0,
    selectMs: 0,
    totalMs: 0,
  };
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 50));
  const usesLocalEmbedding = isLocalEmbeddingConfig(options.embeddingConfig);
  const vectorWeight = Math.max(
    0,
    options.vectorWeight ??
      (usesLocalEmbedding ? DEFAULT_LOCAL_VECTOR_WEIGHT : DEFAULT_VECTOR_WEIGHT),
  );
  const textWeight = Math.max(
    0,
    options.textWeight ?? (usesLocalEmbedding ? DEFAULT_LOCAL_TEXT_WEIGHT : DEFAULT_TEXT_WEIGHT),
  );
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
  const lexicalUnitsForRecall = Array.from(queryUnitCounts.entries()).flatMap(([unit, count]) =>
    Array.from({ length: Math.max(1, Math.min(count, 16)) }, () => unit),
  );
  const selectedLexicalUnits = selectIndexedLexicalUnitsForRecall(lexicalUnitsForRecall, {
    ...(options.memoryKind ? { memoryKind: options.memoryKind } : {}),
    ...(options.lexicalUnitLimit ? { lexicalUnitLimit: options.lexicalUnitLimit } : {}),
  });
  const scoringQueryUnits = buildScoringLexicalUnits(queryUnits, selectedLexicalUnits);
  timing.tokenizeQueryMs = Date.now() - tokenizeStarted;
  timing.queryUnitCount = queryUnits.size;
  const includeUnanchoredCandidates = Boolean(
    trimmedQuery && options.embeddingConfig && vectorWeight > 0 && !usesLocalEmbedding,
  );

  const candidateFetchStarted = Date.now();
  const candidates = listFactsForRecallCandidates({
    limit: candidatePool,
    lexicalUnits: lexicalUnitsForRecall,
    selectedLexicalUnits,
    includeUnanchoredCandidates,
    ...(options.conversationId ? { scopedRecentConversationId: options.conversationId } : {}),
    ...(options.taskId ? { scopedRecentTaskId: options.taskId } : {}),
    ...(candidateScopes ? { scope: candidateScopes } : {}),
    ...(options.memoryKind ? { memoryKind: options.memoryKind } : {}),
    ...(options.includeHistorical ? { includeInvalidated: true } : {}),
    ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
  }).filter((fact) => isFactEligibleForRecall(fact, options));
  timing.candidateBaseFetchMs = Date.now() - candidateFetchStarted;
  if (
    Array.isArray(options.memoryKind)
      ? options.memoryKind.includes('ui_inventory')
      : options.memoryKind === 'ui_inventory'
  ) {
    const observationExpansionStarted = Date.now();
    const observationInventoryNeighbors = listUiInventoriesForObservationContexts(
      candidates
        .filter((fact) => fact.memoryKind !== 'ui_inventory')
        .slice(0, UI_OBSERVATION_CONTEXT_EXPANSION_LIMIT)
        .map((fact) => ({
          sourceRunId: fact.sourceRunId,
          stateIndex:
            typeof fact.attributes.stateIndex === 'string' ||
            typeof fact.attributes.stateIndex === 'number'
              ? fact.attributes.stateIndex
              : null,
          url: typeof fact.attributes.url === 'string' ? fact.attributes.url : null,
        })),
      {
        limit: 32,
        ...(options.includeHistorical ? { includeInvalidated: true } : {}),
        ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
      },
    ).filter((fact) => isFactEligibleForRecall(fact, options));
    const seenCandidateIds = new Set(candidates.map((fact) => fact.id));
    for (const fact of observationInventoryNeighbors) {
      if (seenCandidateIds.has(fact.id)) continue;
      candidates.push(fact);
      seenCandidateIds.add(fact.id);
    }
    timing.observationExpansionMs = Date.now() - observationExpansionStarted;

  }
  timing.candidateFetchMs = Date.now() - candidateFetchStarted;
  timing.candidateCount = candidates.length;
  const candidateTermHitsStarted = Date.now();
  const candidateUnitHits = listFactTermUnitHitsForFacts(
    candidates.map((fact) => fact.id),
    Array.from(scoringQueryUnits),
  );
  const sourceUnitHits = new Map<string, Set<string>>();
  for (const fact of candidates) {
    if (!fact.sourceRunId) continue;
    const hits = candidateUnitHits.get(fact.id);
    if (!hits || hits.size === 0) continue;
    const sourceHits = sourceUnitHits.get(fact.sourceRunId) ?? new Set<string>();
    for (const unit of hits) sourceHits.add(unit);
    sourceUnitHits.set(fact.sourceRunId, sourceHits);
  }
  timing.candidateTermHitsMs = Date.now() - candidateTermHitsStarted;
  timing.candidateHitFactCount = candidateUnitHits.size;

  if (trimmedQuery && candidates.length > 0 && vectorWeight > 0 && options.embeddingConfig) {
    const localEmbeddingsStarted = Date.now();
    await maybeAttachLocalCandidateEmbeddings(
      candidates,
      scoringQueryUnits,
      candidateUnitHits,
      options.embeddingConfig,
    );
    timing.localEmbeddingsMs = Date.now() - localEmbeddingsStarted;
  }
  const unitWeightsStarted = Date.now();
  const unitWeights = buildQueryUnitWeightsFromHits(scoringQueryUnits, candidates, candidateUnitHits);
  timing.unitWeightsMs = Date.now() - unitWeightsStarted;

  const queryEmbeddingStarted = Date.now();
  const hasVectorCandidates =
    vectorWeight > 0 && candidates.some((fact) => fact.embedding && fact.embedding.length > 0);
  const queryEmbedding =
    trimmedQuery && hasVectorCandidates
      ? await maybeEmbedQuery(trimmedQuery, options.embeddingConfig)
      : null;
  timing.queryEmbeddingMs = Date.now() - queryEmbeddingStarted;
  const scoreStarted = Date.now();
  const scored = candidates.map((fact) =>
    buildScoredFact({
      fact,
      queryUnits: scoringQueryUnits,
      queryEmbedding,
      factUnitHits: candidateUnitHits.get(fact.id),
      sourceUnitHits: fact.sourceRunId ? sourceUnitHits.get(fact.sourceRunId) : undefined,
      vectorWeight,
      textWeight,
      unitWeights,
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
  const seenSemanticKeys = new Set<string>();

  if (alwaysIncludePinned) {
    for (const entry of scored) {
      if (!entry.fact.pinned) continue;
      addSelectedFact({ selected, seenIds, seenSemanticKeys, fact: entry.fact, limit });
      if (selected.length >= limit) break;
    }
  }

  if (trimmedQuery && selected.length < limit) {
    const defaultThreshold = queryEmbedding ? DEFAULT_VECTOR_THRESHOLD : DEFAULT_TEXT_THRESHOLD;
    const threshold = options.threshold ?? defaultThreshold;
    const diversifyStarted = Date.now();
    const diversified = diversifyScoredFacts(scored, limit, candidateUnitHits);
    timing.diversifyMs = Date.now() - diversifyStarted;
    for (const entry of diversified) {
      if (entry.relevanceScore < threshold) continue;
      addSelectedFact({ selected, seenIds, seenSemanticKeys, fact: entry.fact, limit });
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

async function maybeEmbedQuery(
  query: string,
  config: EmbeddingConfig | undefined,
): Promise<number[] | null> {
  if (!config) return null;
  try {
    return await getEmbeddingCached(query, config);
  } catch {
    return null;
  }
}

async function maybeAttachLocalCandidateEmbeddings(
  candidates: MemoryFact[],
  queryUnits: Set<string>,
  candidateUnitHits: ReadonlyMap<string, ReadonlySet<string>>,
  config: EmbeddingConfig,
): Promise<void> {
  if (!isLocalEmbeddingConfig(config)) return;
  const missing = candidates
    .filter((fact) => !fact.embedding || fact.embedding.length === 0)
    .map((fact) => ({
      fact,
      textScore: lexicalOverlapFromUnitHits(queryUnits, candidateUnitHits.get(fact.id)),
      strength: Math.max(fact.lastReinforcedAt ?? 0, fact.updatedAt, fact.validAt),
    }))
    .sort((a, b) => {
      if (b.textScore !== a.textScore) return b.textScore - a.textScore;
      if (b.fact.pinned !== a.fact.pinned) return b.fact.pinned ? 1 : -1;
      if (b.fact.importance !== a.fact.importance) return b.fact.importance - a.fact.importance;
      return b.strength - a.strength;
    })
    .slice(0, LOCAL_QUERY_EMBEDDING_ATTACH_LIMIT);

  for (const { fact } of missing) {
    try {
      fact.embedding = await getEmbeddingCached(factHaystack(fact), config);
    } catch {
      // Local vector reranking is opportunistic; lexical scoring remains available.
    }
  }
}

/**
 * Embed a single fact and persist the vector. Used by the consolidator and by
 * lazy backfill in `recallFactsForQuery`. Returns the embedding it stored, or
 * null if embedding failed (the caller should not retry tight-loop).
 */
export async function embedFact(
  fact: MemoryFact,
  config: EmbeddingConfig,
): Promise<number[] | null> {
  try {
    const embedding = await getEmbeddingCached(factHaystack(fact), config);
    setFactEmbedding(fact.id, embedding);
    return embedding;
  } catch {
    return null;
  }
}

/**
 * Backfill embeddings for facts that lack one. Bounded by `maxFacts` (default
 * 32) so a single recall call doesn't snowball into a huge embedder batch.
 * Returns the number of facts successfully embedded.
 */
export async function backfillFactEmbeddings(
  config: EmbeddingConfig,
  options: { maxFacts?: number; asOf?: number } = {},
): Promise<number> {
  const maxFacts = Math.max(1, Math.min(options.maxFacts ?? 32, CANDIDATE_POOL_MAX));
  const candidates = listFactsForRecallCandidates({
    limit: Math.max(CANDIDATE_POOL_LIMIT, maxFacts),
    includeUnanchoredCandidates: true,
    ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
  }).filter((fact) => !fact.embedding || fact.embedding.length === 0);

  let embedded = 0;
  for (const fact of candidates.slice(0, maxFacts)) {
    const result = await embedFact(fact, config);
    if (result) embedded += 1;
  }
  return embedded;
}

/**
 * Query-time recall — the canonical entry point used by prompt assembly.
 *
 * Returns up to `limit` MemoryFact entries ranked by combined score. Pinned
 * facts are always included (consuming slots first) when
 * `alwaysIncludePinned` is true (default).
 *
 * The function is deliberately tolerant of partial inputs: empty queries
 * return only pinned facts; missing embeddings degrade to text-only scoring;
 * embedder failures are swallowed and recall continues with text scoring.
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
