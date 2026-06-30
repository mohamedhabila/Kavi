import { type MemoryFact, type MemoryFactKind, type MemoryFactScope } from './facts/types';

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
  quotedUiControlBoost: number;
  surfaceLabelBoost: number;
  surfaceIdentityScore: number;
  visibleTextEvidenceBoost: number;
  relevanceScore: number;
}
