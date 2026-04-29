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
//   • Lexical overlap     — fraction of query tokens appearing in
//                           "<subject> <predicate> <objectText>". Weight:
//                           textWeight (0.4).
//   • Pinned boost        — additive bump so user-pinned facts always win ties.
//
// The function never throws; embedding failures degrade to text-only scoring.
// All retrieved facts are currently-valid (`invalid_at IS NULL`) by default —
// callers can pass `asOf` for historical queries.
// ---------------------------------------------------------------------------

import type { EmbeddingConfig } from '../../types';
import { cosineSimilarity, getEmbeddingCached } from './embeddings';
import {
  listFacts,
  setFactEmbedding,
  type MemoryFact,
} from './facts';

const DEFAULT_LIMIT = 8;
const DEFAULT_SIMILARITY_THRESHOLD = 0.45;
const DEFAULT_TEXT_THRESHOLD = 0.1
const DEFAULT_VECTOR_WEIGHT = 0.6;
const DEFAULT_TEXT_WEIGHT = 0.4;
const PINNED_BOOST = 0.25;
const CANDIDATE_POOL_LIMIT = 500;

export interface RecallFactsOptions {
  /**
   * If supplied, the query is embedded and vector similarity is added to the
   * score. When omitted, scoring falls back to lexical overlap only.
   */
  embeddingConfig?: EmbeddingConfig;
  /** Maximum facts returned. Default 8. */
  limit?: number;
  /**
   * Combined-score floor for inclusion. The combined score is a weighted sum
   * (vectorWeight * cosine + textWeight * lexicalOverlap + pinnedBoost), so
   * thresholds are on the weighted scale, not raw similarity. Vector path
   * defaults to 0.45 (cosine ≈ 0.75 with default 0.6 weight); text-only
   * defaults to 0.1 (≈ 25% query-token overlap with default 0.4 weight).
   *osine + textWeight * lexicalOverlap + pinnedBoost), so
   * thresholds are on the weighted scale, not raw similarity. Vector path
   * defaults to 0.45 (cosine ≈ 0.75 with default 0.6 weight); text-only
   * defaults to 0.1 (≈ 25% query-token overlap with default 0.4 weight).
   * Override to widen/tighten the funnel per turn.
   */
  threshold?: number;
  /** Vector-component weight. Default 0.6. Set to 0 to disable vectors. */
  vectorWeight?: number;
  /** Text-component weight. Default 0.4. Set to 0 to disable lexical match. */
  textWeight?: number;
  /** Bi-temporal anchor — facts valid at this ms timestamp. */
  asOf?: number;
  /**
   * When true (default), pinned facts are always returned regardless of
   * threshold and consume `limit` slots first.
   */
  alwaysIncludePinned?: boolean;
  /**
   * Pool of candidates pulled from the store before scoring. Larger = more
   * recall, slower scoring. Default 500.
   */
  candidatePoolLimit?: number;
}

export interface ScoredFact {
  fact: MemoryFact;
  score: number;
  vectorScore: number;
  textScore: number;
  pinnedBoost: number;
}

const TOKEN_SPLIT = /[^a-z0-9]+/i;

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(TOKEN_SPLIT)
      .filter((token) => token.length >= 2),
  );
}

function lexicalOverlap(queryTokens: Set<string>, factText: string): number {
  if (queryTokens.size === 0) return 0;
  const factTokens = tokenize(factText);
  if (factTokens.size === 0) return 0;
  let hits = 0;
  for (const token of queryTokens) {
    if (factTokens.has(token)) hits += 1;
  }
  return hits / queryTokens.size;
}

function factHaystack(fact: MemoryFact): string {
  return `${fact.subjectId} ${fact.predicate} ${fact.objectText}`;
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
  const maxFacts = Math.max(1, Math.min(options.maxFacts ?? 32, 200));
  const candidates = listFacts({
    limit: CANDIDATE_POOL_LIMIT,
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
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 50));
  const vectorWeight = Math.max(0, options.vectorWeight ?? DEFAULT_VECTOR_WEIGHT);
  const textWeight = Math.max(0, options.textWeight ?? DEFAULT_TEXT_WEIGHT);
  const candidatePool = Math.max(
    limit,
    Math.min(options.candidatePoolLimit ?? CANDIDATE_POOL_LIMIT, CANDIDATE_POOL_LIMIT),
  );
  const alwaysIncludePinned = options.alwaysIncludePinned !== false;
  const trimmedQuery = query.trim();

  const candidates = listFacts({
    limit: candidatePool,
    ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
  });

  // Pinned-only fast path: empty query, just return the pinned set.
  if (!trimmedQuery) {
    if (!alwaysIncludePinned) return [];
    return candidates.filter((fact) => fact.pinned).slice(0, limit);
  }

  const queryTokens = tokenize(trimmedQuery);
  const queryEmbedding = vectorWeight > 0
    ? await maybeEmbedQuery(trimmedQuery, options.embeddingConfig)
    : null;

  const defaultThreshold = queryEmbedding
    ? DEFAULT_SIMILARITY_THRESHOLD
    : DEFAULT_TEXT_THRESHOLD;
  const threshold = options.threshold ?? defaultThreshold;

  const scored: ScoredFact[] = [];
  for (const fact of candidates) {
    const haystack = factHaystack(fact);
    const textScore = textWeight > 0 ? lexicalOverlap(queryTokens, haystack) : 0;
    const vectorScore =
      queryEmbedding && fact.embedding && fact.embedding.length > 0 && vectorWeight > 0
        ? Math.max(0, cosineSimilarity(queryEmbedding, fact.embedding))
        : 0;
    const pinnedBoost = alwaysIncludePinned && fact.pinned ? PINNED_BOOST : 0;
    const score = vectorWeight * vectorScore + textWeight * textScore + pinnedBoost;
    scored.push({ fact, score, vectorScore, textScore, pinnedBoost });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: more recent fact wins.
    return b.fact.updatedAt - a.fact.updatedAt;
  });

  const selected: MemoryFact[] = [];
  const seen = new Set<string>();

  if (alwaysIncludePinned) {
    for (const entry of scored) {
      if (!entry.fact.pinned) continue;
      if (seen.has(entry.fact.id)) continue;
      selected.push(entry.fact);
      seen.add(entry.fact.id);
      if (selected.length >= limit) return selected;
    }
  }

  for (const entry of scored) {
    if (seen.has(entry.fact.id)) continue;
    if (entry.score < threshold) continue;
    selected.push(entry.fact);
    seen.add(entry.fact.id);
    if (selected.length >= limit) break;
  }

  return selected;
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
  const facts = await recallFactsForQuery(query, options);
  if (facts.length === 0) return [];

  const queryTokens = tokenize(query.trim());
  const queryEmbedding = options.vectorWeight !== 0 && options.embeddingConfig
    ? await maybeEmbedQuery(query, options.embeddingConfig)
    : null;
  const vectorWeight = Math.max(0, options.vectorWeight ?? DEFAULT_VECTOR_WEIGHT);
  const textWeight = Math.max(0, options.textWeight ?? DEFAULT_TEXT_WEIGHT);
  const alwaysIncludePinned = options.alwaysIncludePinned !== false;

  return facts.map((fact) => {
    const textScore = textWeight > 0 ? lexicalOverlap(queryTokens, factHaystack(fact)) : 0;
    const vectorScore =
      queryEmbedding && fact.embedding && fact.embedding.length > 0 && vectorWeight > 0
        ? Math.max(0, cosineSimilarity(queryEmbedding, fact.embedding))
        : 0;
    const pinnedBoost = alwaysIncludePinned && fact.pinned ? PINNED_BOOST : 0;
    return {
      fact,
      vectorScore,
      textScore,
      pinnedBoost,
      score: vectorWeight * vectorScore + textWeight * textScore + pinnedBoost,
    };
  });
}
