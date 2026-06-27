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
// The function never throws; remote embedding failures degrade to text scoring.
// The default app path uses the local Unicode n-gram provider, which avoids
// network dependency while preserving multilingual recall. Text-only candidate
// generation is index-backed. Query-time local embeddings are attached
// transiently for reranking; durable embedding writes belong to explicit
// background backfill, not the user-turn read path.
// All retrieved facts are currently-valid (`invalid_at IS NULL`) by default —
// callers can pass `asOf` for historical queries.
// ---------------------------------------------------------------------------

import type { EmbeddingConfig } from '../../types/memory';
import { getEmbeddingCached, isLocalEmbeddingConfig } from './embeddings';
import { markFactsRecalled, setFactEmbedding } from './facts/mutations';
import { listFactsForRecallCandidates } from './facts/queries';
import { type MemoryFact, type MemoryFactKind, type MemoryFactScope } from './facts/types';
import {
  buildQueryUnitWeights,
  lexicalOverlap,
  tokenizeLexicalUnits,
} from './ranking/lexical';
import { retrievalTextForFact } from './ranking/factText';
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
const CANDIDATE_POOL_LIMIT = 512;
const CANDIDATE_POOL_MAX = 2_000;
const LOCAL_QUERY_EMBEDDING_ATTACH_LIMIT = 128;
const RELEVANCE_EPSILON = 1e-6;
const TRAJECTORY_NEIGHBOR_LIMIT = 4;

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
   * recall, slower scoring. Default 512.
   */
  candidatePoolLimit?: number;
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

function diversifyScoredFacts(scored: ScoredFact[], limit: number): ScoredFact[] {
  return diversifyTrajectoryAware(scored, limit, {
    textForFact: factHaystack,
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

function factSemanticKey(fact: MemoryFact): string {
  return [
    fact.subjectId,
    fact.predicate.normalize('NFKC').toLocaleLowerCase().trim(),
    fact.objectText.normalize('NFKC').toLocaleLowerCase().trim(),
  ].join('\u0000');
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
    vectorWeight,
    textWeight,
    alwaysIncludePinned,
    options,
    now,
  } = params;
  const haystack = factHaystack(fact);
  const textScore = textWeight > 0 ? lexicalOverlap(queryUnits, haystack, params.unitWeights) : 0;
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
  const queryUnits = tokenizeLexicalUnits(trimmedQuery);
  const includeUnanchoredCandidates = Boolean(
    trimmedQuery && options.embeddingConfig && vectorWeight > 0 && !usesLocalEmbedding,
  );

  const candidates = listFactsForRecallCandidates({
    limit: candidatePool,
    lexicalUnits: Array.from(queryUnits),
    includeUnanchoredCandidates,
    ...(options.conversationId ? { scopedRecentConversationId: options.conversationId } : {}),
    ...(options.taskId ? { scopedRecentTaskId: options.taskId } : {}),
    ...(candidateScopes ? { scope: candidateScopes } : {}),
    ...(options.memoryKind ? { memoryKind: options.memoryKind } : {}),
    ...(options.includeHistorical ? { includeInvalidated: true } : {}),
    ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
  }).filter((fact) => isFactEligibleForRecall(fact, options));

  if (trimmedQuery && vectorWeight > 0 && options.embeddingConfig) {
    await maybeAttachLocalCandidateEmbeddings(candidates, queryUnits, options.embeddingConfig);
  }
  const unitWeights = buildQueryUnitWeights(queryUnits, candidates, factHaystack);

  const queryEmbedding =
    trimmedQuery && vectorWeight > 0
      ? await maybeEmbedQuery(trimmedQuery, options.embeddingConfig)
      : null;
  const scored = candidates.map((fact) =>
    buildScoredFact({
      fact,
      queryUnits,
      queryEmbedding,
      vectorWeight,
      textWeight,
      unitWeights,
      alwaysIncludePinned,
      options,
      now,
    }),
  );
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.fact.updatedAt - a.fact.updatedAt;
  });
  const scoredById = new Map(scored.map((entry) => [entry.fact.id, entry]));

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
    const diversified = diversifyScoredFacts(scored, limit);
    for (const entry of diversified) {
      if (entry.relevanceScore < threshold) continue;
      addSelectedFact({ selected, seenIds, seenSemanticKeys, fact: entry.fact, limit });
      if (selected.length >= limit) break;
    }
  }

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
  config: EmbeddingConfig,
): Promise<void> {
  if (!isLocalEmbeddingConfig(config)) return;
  const missing = candidates
    .filter((fact) => !fact.embedding || fact.embedding.length === 0)
    .map((fact) => ({
      fact,
      textScore: lexicalOverlap(queryUnits, factHaystack(fact)),
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
