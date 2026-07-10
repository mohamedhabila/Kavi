import { type MemoryFact, type MemoryFactKind, type MemoryFactScope } from './facts/types';
import type { MemoryAccessScopeIdentity } from './memoryScopeIdentity';
import type { MemoryApplicabilityUseIntent } from './memoryApplicabilityTypes';
import type {
  RecallCandidateProvenance,
  RecallCandidateStageTelemetry,
  RecallCandidateStrategy,
  RecallLocalSemanticInput,
} from './factRecallCandidateContract';

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
  scopeHints?: MemoryFactScope[];
  /** Exact scope filter for callers that expose user-visible scope controls. */
  scopeFilter?: MemoryFactScope | MemoryFactScope[];
  /** Exact code-owned access identity used before any candidate reaches scoring. */
  memoryScope: MemoryAccessScopeIdentity;
  /** Structural request intent; never inferred from query text. */
  useIntent: MemoryApplicabilityUseIntent;
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
  /** Separately bounded non-direct candidates that may only be asked about or abstained on. */
  resolutionCandidateLimit?: number;
  /** Maximum query lexical units used for indexed recall fanout. */
  lexicalUnitLimit?: number;
  /** Candidate union strategy. Production uses hybrid; lexical is the same-path ablation. */
  candidateStrategy?: RecallCandidateStrategy;
  /** Optional compatible local query vector. Retrieval never creates or fetches one. */
  localSemantic?: RecallLocalSemanticInput;
  /** Maximum already-eligible facts inspected by supplemental local lanes. */
  eligibleScanLimit?: number;
  /** Optional recall-stage telemetry for product diagnostics. */
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
  candidateStages?: RecallCandidateStageTelemetry;
  resolutionCandidateCount?: number;
  resolutionCandidateFetchMs?: number;
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
  candidateRelevanceScore: number;
  candidateProvenance: RecallCandidateProvenance;
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
  candidates: ReadonlyArray<MemoryFactSelectionCandidate>;
}

export interface MemoryFactSelectionResult {
  factIds: string[];
}

export type MemoryFactSelector = (
  request: MemoryFactSelectionRequest,
) => Promise<MemoryFactSelectionResult>;
