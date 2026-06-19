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
//   • Lexical overlap     — fraction of query lexical units appearing in
//                           "<subject> <predicate> <objectText>". Weight:
//                           textWeight (0.4).
//   • Pinned boost        — additive bump so user-pinned facts always win ties.
//
// The function never throws; embedding failures degrade to text-only scoring.
// All retrieved facts are currently-valid (`invalid_at IS NULL`) by default —
// callers can pass `asOf` for historical queries.
// ---------------------------------------------------------------------------

import type { EmbeddingConfig } from '../../types/memory';
import { getEmbeddingCached } from './embeddings';
import { markFactsRecalled, setFactEmbedding } from './facts/mutations';
import { listFacts } from './facts/queries';
import { type MemoryFact, type MemoryFactScope } from './facts/types';
import { cosineSimilarity } from './ranking/similarity';
import { exponentialDecayMultiplier } from './ranking/scoring';

const DEFAULT_LIMIT = 8;
const DEFAULT_SIMILARITY_THRESHOLD = 0.45;
const DEFAULT_TEXT_THRESHOLD = 0.1;
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
   * defaults to 0.1 (≈ 25% query lexical-unit overlap with default 0.4 weight).
   * Override to widen/tighten the funnel per turn.
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
  now?: number;
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
  /**
   * Include the newest valid facts that are explicitly linked to the active
   * conversation/task before filling the remaining slots by relevance. This
   * keeps one-conversation working memory current without language heuristics.
   * Default true.
   */
  includeRecentContextFacts?: boolean;
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
}

type WordSegment = {
  segment: string;
  isWordLike?: boolean;
};

type WordSegmenter = {
  segment(input: string): Iterable<WordSegment>;
};

type WordSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: 'word' },
) => WordSegmenter;

const WORD_LIKE_SEQUENCE_PATTERN = /[\p{L}\p{M}\p{N}]+/gu;
const WORD_LIKE_CODE_POINT_PATTERN = /[\p{L}\p{N}]/u;
const CONTINUOUS_WORD_SCRIPT_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

let cachedWordSegmenter: WordSegmenter | null | undefined;

function getWordSegmenter(): WordSegmenter | null {
  if (cachedWordSegmenter !== undefined) return cachedWordSegmenter;
  const segmenterCtor = (
    Intl as typeof Intl & {
      Segmenter?: WordSegmenterConstructor;
    }
  ).Segmenter;
  cachedWordSegmenter =
    typeof segmenterCtor === 'function'
      ? new segmenterCtor(undefined, { granularity: 'word' })
      : null;
  return cachedWordSegmenter;
}

function normalizeLexicalText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function hasWordLikeCodePoint(value: string): boolean {
  return WORD_LIKE_CODE_POINT_PATTERN.test(value);
}

function addSegmentUnits(units: Set<string>, rawSegment: string): void {
  const segment = normalizeLexicalText(rawSegment).trim();
  if (!segment || !hasWordLikeCodePoint(segment)) return;
  units.add(segment);

  if (!CONTINUOUS_WORD_SCRIPT_PATTERN.test(segment)) return;
  const codePoints = Array.from(segment);
  for (const width of [2, 3]) {
    if (codePoints.length < width) continue;
    for (let index = 0; index <= codePoints.length - width; index += 1) {
      units.add(`${width}:${codePoints.slice(index, index + width).join('')}`);
    }
  }
}

function addUnicodeSequenceUnits(units: Set<string>, value: string): void {
  WORD_LIKE_SEQUENCE_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(WORD_LIKE_SEQUENCE_PATTERN)) {
    addSegmentUnits(units, match[0]);
  }
}

function tokenize(value: string): Set<string> {
  const normalized = normalizeLexicalText(value);
  const units = new Set<string>();
  const segmenter = getWordSegmenter();
  if (segmenter) {
    for (const segment of segmenter.segment(normalized)) {
      if (segment.isWordLike === false) continue;
      addSegmentUnits(units, segment.segment);
    }
  }
  addUnicodeSequenceUnits(units, normalized);
  return units;
}

function lexicalOverlap(queryUnits: Set<string>, factText: string): number {
  if (queryUnits.size === 0) return 0;
  const factUnits = tokenize(factText);
  if (factUnits.size === 0) return 0;
  let hits = 0;
  for (const unit of queryUnits) {
    if (factUnits.has(unit)) hits += 1;
  }
  return hits / queryUnits.size;
}

function lexicalUnitJaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const unit of left) {
    if (right.has(unit)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function factHaystack(fact: MemoryFact): string {
  return `${fact.subjectId} ${fact.predicate} ${fact.objectText} ${fact.sourceSummary ?? ''}`;
}

function diversifyScoredFacts(scored: ScoredFact[], limit: number): ScoredFact[] {
  const remaining = [...scored];
  const selected: ScoredFact[] = [];
  const selectedUnits: Array<Set<string>> = [];
  while (remaining.length > 0 && selected.length < Math.max(limit * 2, limit)) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const candidateUnits = tokenize(factHaystack(candidate.fact));
      const redundancy = selectedUnits.length
        ? Math.max(...selectedUnits.map((units) => lexicalUnitJaccard(candidateUnits, units)))
        : 0;
      const mmrScore = candidate.score * 0.82 - redundancy * 0.18;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = index;
      }
    }
    const [picked] = remaining.splice(bestIndex, 1);
    selected.push(picked);
    selectedUnits.push(tokenize(factHaystack(picked.fact)));
  }
  return [...selected, ...remaining];
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

function factContextMatches(fact: MemoryFact, options: RecallFactsOptions): boolean {
  if (options.conversationId && fact.originConversationId === options.conversationId) {
    return true;
  }
  if (options.taskId && fact.originTaskId === options.taskId) {
    return true;
  }
  return false;
}

function factSemanticKey(fact: MemoryFact): string {
  return [
    fact.subjectId,
    fact.predicate.normalize('NFKC').toLocaleLowerCase().trim(),
    fact.objectText.normalize('NFKC').toLocaleLowerCase().trim(),
  ].join('\u0000');
}

function selectRecentContextFacts(
  candidates: MemoryFact[],
  options: RecallFactsOptions,
  limit: number,
): MemoryFact[] {
  if (options.includeRecentContextFacts === false) return [];
  if (!options.conversationId && !options.taskId) return [];

  const selected: MemoryFact[] = [];
  const seen = new Set<string>();
  const ranked = candidates
    .filter((fact) => factContextMatches(fact, options))
    .sort((a, b) => {
      const aStrength = Math.max(a.lastReinforcedAt ?? 0, a.updatedAt, a.validAt);
      const bStrength = Math.max(b.lastReinforcedAt ?? 0, b.updatedAt, b.validAt);
      if (bStrength !== aStrength) return bStrength - aStrength;
      if (b.importance !== a.importance) return b.importance - a.importance;
      return b.createdAt - a.createdAt;
    });

  for (const fact of ranked) {
    const key = factSemanticKey(fact);
    if (seen.has(key)) continue;
    selected.push(fact);
    seen.add(key);
    if (selected.length >= limit) break;
  }
  return selected;
}

function scoreScope(fact: MemoryFact, options: RecallFactsOptions): number {
  if (fact.scope === 'conversation' && fact.originConversationId === options.conversationId) {
    return 0.18;
  }
  if (fact.scope === 'session' && fact.originTaskId === options.taskId) {
    return 0.16;
  }
  if (options.scopeHints?.includes(fact.scope)) return 0.1;
  if (fact.scope === 'global') return 0.04;
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
  return Math.min(0.12, Math.log1p(fact.accessCount + fact.repeatedMentionCount) * 0.035);
}

function buildScoredFact(params: {
  fact: MemoryFact;
  queryUnits: Set<string>;
  queryEmbedding: number[] | null;
  vectorWeight: number;
  textWeight: number;
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
  const textScore = textWeight > 0 ? lexicalOverlap(queryUnits, haystack) : 0;
  const vectorScore =
    queryEmbedding && fact.embedding && fact.embedding.length > 0 && vectorWeight > 0
      ? Math.max(0, cosineSimilarity(queryEmbedding, fact.embedding))
      : 0;
  const pinnedBoost = alwaysIncludePinned && fact.pinned ? PINNED_BOOST : 0;
  const decayMultiplier = scoreDecay(fact, now);
  const scopeBoost = scoreScope(fact, options);
  const reinforcementBoost = scoreReinforcement(fact);
  const importanceScore = fact.importance * 0.1;
  const retrievalScore = vectorWeight * vectorScore + textWeight * textScore;
  const score =
    retrievalScore * fact.confidence * decayMultiplier +
    pinnedBoost +
    scopeBoost +
    reinforcementBoost +
    importanceScore;
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
  const vectorWeight = Math.max(0, options.vectorWeight ?? DEFAULT_VECTOR_WEIGHT);
  const textWeight = Math.max(0, options.textWeight ?? DEFAULT_TEXT_WEIGHT);
  const candidatePool = Math.max(
    limit,
    Math.min(options.candidatePoolLimit ?? CANDIDATE_POOL_LIMIT, CANDIDATE_POOL_LIMIT),
  );
  const alwaysIncludePinned = options.alwaysIncludePinned !== false;
  const trimmedQuery = query.trim();
  const now = options.now ?? options.asOf ?? Date.now();
  const candidateScopes = getCandidateScopes(options);

  const candidates = listFacts({
    limit: candidatePool,
    ...(candidateScopes ? { scope: candidateScopes } : {}),
    ...(options.includeHistorical ? { includeInvalidated: true } : {}),
    ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
  }).filter((fact) => isFactEligibleForRecall(fact, options));

  const queryUnits = tokenize(trimmedQuery);
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

  if (selected.length < limit) {
    for (const fact of selectRecentContextFacts(candidates, options, limit)) {
      addSelectedFact({ selected, seenIds, seenSemanticKeys, fact, limit });
      if (selected.length >= limit) break;
    }
  }

  if (trimmedQuery && selected.length < limit) {
    const defaultThreshold = queryEmbedding ? DEFAULT_SIMILARITY_THRESHOLD : DEFAULT_TEXT_THRESHOLD;
    const threshold = options.threshold ?? defaultThreshold;
    const diversified = diversifyScoredFacts(scored, limit);
    for (const entry of diversified) {
      if (entry.score < threshold) continue;
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
