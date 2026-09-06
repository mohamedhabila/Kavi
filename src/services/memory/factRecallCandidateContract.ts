import type { LocalSimilarityVector } from './localSimilarity';
import type { ProviderEmbeddingVector } from './providerSimilarity';

export const RECALL_CANDIDATE_STRATEGIES = ['lexical', 'hybrid'] as const;
export type RecallCandidateStrategy = (typeof RECALL_CANDIDATE_STRATEGIES)[number];

export const RECALL_CANDIDATE_REASON_CODES = [
  'pinned',
  'exact_quoted',
  'lexical',
  'entity',
  'temporal',
  'local_similarity',
] as const;
export type RecallCandidateReasonCode = (typeof RECALL_CANDIDATE_REASON_CODES)[number];

export const RECALL_LOCAL_SIMILARITY_OUTCOMES = [
  'not_requested',
  'unavailable',
  'applied',
] as const;
export type RecallLocalSimilarityOutcome = (typeof RECALL_LOCAL_SIMILARITY_OUTCOMES)[number];

export const RECALL_CANDIDATE_LIMITS = Object.freeze({
  defaultUnion: 128,
  maximumUnion: 2_000,
  defaultEligibleScan: 256,
  maximumEligibleScan: 500,
  pinnedLane: 64,
  exactQuotedLane: 24,
  entityLane: 32,
  temporalLane: 24,
  localSimilarityLane: 32,
  reciprocalRankConstant: 60,
});

export interface RecallLocalSimilarityInput {
  queryVector: LocalSimilarityVector;
  minimumSimilarity?: number;
  /**
   * One provider query vector, already resolved and embedded once per turn
   * by the memory-access gateway. Retrieval never creates or fetches one —
   * when present and a candidate has a compatible (same-model) vector, it is
   * the primary semantic signal; otherwise the local n-gram vector above is
   * the fallback.
   */
  providerQueryVector?: ProviderEmbeddingVector;
}

export interface RecallCandidateStageTelemetry {
  strategy: RecallCandidateStrategy;
  localSimilarityOutcome: RecallLocalSimilarityOutcome;
  eligibleScanCount: number;
  pinnedCount: number;
  exactQuotedCount: number;
  lexicalCount: number;
  entityCount: number;
  temporalCount: number;
  localSimilarityCount: number;
  unionCount: number;
  diversifiedCount: number;
  unionMs: number;
}

export interface RecallCandidateProvenance {
  reasons: ReadonlyArray<RecallCandidateReasonCode>;
  fusionScore: number;
  /** The semantic lane's selection score — provider cosine when compatible, else local n-gram cosine. */
  localSimilarityScore: number | null;
  /** Non-null only when a same-model provider vector was compared for this candidate. */
  providerSimilarityScore: number | null;
}
