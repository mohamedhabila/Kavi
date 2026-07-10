export const RECALL_CANDIDATE_STRATEGIES = ['lexical', 'hybrid'] as const;
export type RecallCandidateStrategy = (typeof RECALL_CANDIDATE_STRATEGIES)[number];

export const RECALL_CANDIDATE_REASON_CODES = [
  'pinned',
  'exact_quoted',
  'lexical',
  'entity',
  'temporal',
  'local_semantic',
] as const;
export type RecallCandidateReasonCode = (typeof RECALL_CANDIDATE_REASON_CODES)[number];

export const RECALL_LOCAL_SEMANTIC_OUTCOMES = ['not_requested', 'unavailable', 'applied'] as const;
export type RecallLocalSemanticOutcome = (typeof RECALL_LOCAL_SEMANTIC_OUTCOMES)[number];

export const RECALL_CANDIDATE_LIMITS = Object.freeze({
  defaultUnion: 128,
  maximumUnion: 2_000,
  defaultEligibleScan: 256,
  maximumEligibleScan: 500,
  pinnedLane: 64,
  exactQuotedLane: 24,
  entityLane: 32,
  temporalLane: 24,
  localSemanticLane: 32,
  reciprocalRankConstant: 60,
});

export interface RecallLocalSemanticInput {
  queryVector: LocalSimilarityVector;
  minimumSimilarity?: number;
}

export interface RecallCandidateStageTelemetry {
  strategy: RecallCandidateStrategy;
  localSemanticOutcome: RecallLocalSemanticOutcome;
  eligibleScanCount: number;
  pinnedCount: number;
  exactQuotedCount: number;
  lexicalCount: number;
  entityCount: number;
  temporalCount: number;
  localSemanticCount: number;
  unionCount: number;
  diversifiedCount: number;
  unionMs: number;
}

export interface RecallCandidateProvenance {
  reasons: ReadonlyArray<RecallCandidateReasonCode>;
  fusionScore: number;
  semanticSimilarity: number | null;
}
import type { LocalSimilarityVector } from './localSimilarity';
