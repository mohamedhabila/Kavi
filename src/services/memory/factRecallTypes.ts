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
  /**
   * Optional semantic selector that reranks the locally-ranked candidate pool.
   * The local scorer remains the source of candidates and the fallback path
   * when the selector is unavailable or returns no usable ids.
   */
  selector?: MemoryFactSelector;
  /** Maximum locally-ranked candidates shown to the semantic selector. */
  selectorCandidateLimit?: number;
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
  selectorMs?: number;
  selectorCandidateCount?: number;
  selectorSelectedCount?: number;
  selectorApplied?: boolean;
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

export interface MemoryFactSelectionCandidate {
  fact: MemoryFact;
  score: number;
  textScore: number;
  relevanceScore: number;
}

export interface MemoryFactSelectionRequest {
  query: string;
  limit: number;
  /**
   * Desired evidence-slate size within the caller's bounded limit. Selectors
   * should return an ordered slate near this size when candidates contain
   * plausible support, rather than collapsing to one broad topical match.
   */
  targetCount: number;
  candidates: ReadonlyArray<MemoryFactSelectionCandidate>;
}

export interface MemoryFactSelectionResult {
  factIds: string[];
}

export type MemoryFactSelector = (
  request: MemoryFactSelectionRequest,
) => Promise<MemoryFactSelectionResult>;
