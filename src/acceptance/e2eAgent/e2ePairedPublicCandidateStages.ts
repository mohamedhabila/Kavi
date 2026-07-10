import { RECALL_CANDIDATE_LIMITS } from '../../services/memory/factRecallCandidateContract';
import {
  MEMORY_RETRIEVAL_CANDIDATE_STRATEGIES,
  MEMORY_RETRIEVAL_LOCAL_SEMANTIC_OUTCOMES,
  type MemoryRetrievalCandidateStrategy,
  type MemoryRetrievalCandidates,
  type MemoryRetrievalLocalSimilarityOutcome,
} from '../../services/memory/retrievalEventTypes';

const MAX_TIMING_MS = 600_000;
const CANDIDATE_STAGE_KEYS = new Set([
  'strategy',
  'localSimilarityOutcome',
  'eligibleScanCount',
  'pinnedCount',
  'exactQuotedCount',
  'lexicalCount',
  'entityCount',
  'temporalCount',
  'localSimilarityCount',
  'unionCount',
  'diversifiedCount',
  'unionMs',
]);

export type E2EPairedPublicCandidateStages = Readonly<{
  strategyCounts: Readonly<{
    notRequested: number;
    lexical: number;
    hybrid: number;
  }>;
  localSimilarityOutcomeCounts: Readonly<{
    notRequested: number;
    unavailable: number;
    applied: number;
  }>;
  totals: Readonly<{
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
  }>;
  unionMsMax: number;
}>;

export interface E2EPairedCandidateStageAccumulator {
  strategyCounts: { notRequested: number; lexical: number; hybrid: number };
  localSimilarityOutcomeCounts: { notRequested: number; unavailable: number; applied: number };
  totals: {
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
  };
  unionMsMax: number;
}

function boundedInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`${label} must be a bounded non-negative integer.`);
  }
  return value as number;
}

function closedEnum<T extends string>(value: unknown, allowed: ReadonlyArray<T>, label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${label} is unsupported.`);
  }
  return value as T;
}

function addBounded(left: number, right: number, label: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new Error(`${label} exceeds the safe integer bound.`);
  return sum;
}

export function createE2EPairedCandidateStageAccumulator(): E2EPairedCandidateStageAccumulator {
  return {
    strategyCounts: { notRequested: 0, lexical: 0, hybrid: 0 },
    localSimilarityOutcomeCounts: { notRequested: 0, unavailable: 0, applied: 0 },
    totals: {
      eligibleScanCount: 0,
      pinnedCount: 0,
      exactQuotedCount: 0,
      lexicalCount: 0,
      entityCount: 0,
      temporalCount: 0,
      localSimilarityCount: 0,
      unionCount: 0,
      diversifiedCount: 0,
      unionMs: 0,
    },
    unionMsMax: 0,
  };
}

function normalizeCandidateStages(input: unknown): MemoryRetrievalCandidates {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('retrieval.candidates must be a closed object.');
  }
  const candidate = input as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (
    keys.length !== CANDIDATE_STAGE_KEYS.size ||
    keys.some((key) => !CANDIDATE_STAGE_KEYS.has(key))
  ) {
    throw new Error('retrieval.candidates must contain only the closed candidate-stage fields.');
  }
  return {
    strategy: closedEnum(
      candidate.strategy,
      MEMORY_RETRIEVAL_CANDIDATE_STRATEGIES,
      'retrieval.candidates.strategy',
    ),
    localSimilarityOutcome: closedEnum(
      candidate.localSimilarityOutcome,
      MEMORY_RETRIEVAL_LOCAL_SEMANTIC_OUTCOMES,
      'retrieval.candidates.localSimilarityOutcome',
    ),
    eligibleScanCount: boundedInteger(
      candidate.eligibleScanCount,
      'retrieval.candidates.eligibleScanCount',
      RECALL_CANDIDATE_LIMITS.maximumEligibleScan,
    ),
    pinnedCount: boundedInteger(
      candidate.pinnedCount,
      'retrieval.candidates.pinnedCount',
      RECALL_CANDIDATE_LIMITS.maximumUnion,
    ),
    exactQuotedCount: boundedInteger(
      candidate.exactQuotedCount,
      'retrieval.candidates.exactQuotedCount',
      RECALL_CANDIDATE_LIMITS.maximumUnion,
    ),
    lexicalCount: boundedInteger(
      candidate.lexicalCount,
      'retrieval.candidates.lexicalCount',
      RECALL_CANDIDATE_LIMITS.maximumUnion,
    ),
    entityCount: boundedInteger(
      candidate.entityCount,
      'retrieval.candidates.entityCount',
      RECALL_CANDIDATE_LIMITS.entityLane,
    ),
    temporalCount: boundedInteger(
      candidate.temporalCount,
      'retrieval.candidates.temporalCount',
      RECALL_CANDIDATE_LIMITS.temporalLane,
    ),
    localSimilarityCount: boundedInteger(
      candidate.localSimilarityCount,
      'retrieval.candidates.localSimilarityCount',
      RECALL_CANDIDATE_LIMITS.localSimilarityLane,
    ),
    unionCount: boundedInteger(
      candidate.unionCount,
      'retrieval.candidates.unionCount',
      RECALL_CANDIDATE_LIMITS.maximumUnion,
    ),
    diversifiedCount: boundedInteger(
      candidate.diversifiedCount,
      'retrieval.candidates.diversifiedCount',
      RECALL_CANDIDATE_LIMITS.maximumUnion,
    ),
    unionMs: boundedInteger(candidate.unionMs, 'retrieval.candidates.unionMs', MAX_TIMING_MS),
  };
}

function validateCandidateStages(
  candidates: MemoryRetrievalCandidates,
  candidateFactCount: number,
  factRecallMs: number,
): void {
  const stageValues = [
    candidates.eligibleScanCount,
    candidates.pinnedCount,
    candidates.exactQuotedCount,
    candidates.lexicalCount,
    candidates.entityCount,
    candidates.temporalCount,
    candidates.localSimilarityCount,
    candidates.unionCount,
    candidates.diversifiedCount,
    candidates.unionMs,
  ];
  if (
    candidates.unionMs > factRecallMs ||
    (candidates.localSimilarityOutcome !== 'applied' && candidates.localSimilarityCount !== 0) ||
    (candidates.strategy === 'not_requested' &&
      (candidates.localSimilarityOutcome !== 'not_requested' ||
        stageValues.some((value) => value !== 0)))
  ) {
    throw new Error('Paired retrieval candidate stage is inconsistent.');
  }
  if (
    candidates.strategy === 'lexical' &&
    (candidates.localSimilarityOutcome !== 'not_requested' ||
      candidates.eligibleScanCount !== 0 ||
      candidates.entityCount !== 0 ||
      candidates.temporalCount !== 0 ||
      candidates.localSimilarityCount !== 0 ||
      candidates.unionCount !== candidateFactCount ||
      candidates.diversifiedCount !== candidateFactCount ||
      candidates.unionMs !== 0)
  ) {
    throw new Error('Paired retrieval candidate stage is inconsistent.');
  }
  const laneCount =
    candidates.pinnedCount +
    candidates.exactQuotedCount +
    candidates.lexicalCount +
    candidates.entityCount +
    candidates.temporalCount +
    candidates.localSimilarityCount;
  if (
    candidates.strategy === 'hybrid' &&
    (candidateFactCount > RECALL_CANDIDATE_LIMITS.maximumUnion ||
      candidates.pinnedCount > RECALL_CANDIDATE_LIMITS.pinnedLane ||
      candidates.exactQuotedCount > RECALL_CANDIDATE_LIMITS.exactQuotedLane ||
      candidates.entityCount > candidates.eligibleScanCount ||
      candidates.temporalCount > candidates.eligibleScanCount ||
      candidates.localSimilarityCount > candidates.eligibleScanCount ||
      candidates.unionCount < candidateFactCount ||
      candidates.unionCount > laneCount ||
      candidates.diversifiedCount > candidateFactCount)
  ) {
    throw new Error('Paired retrieval candidate stage is inconsistent.');
  }
}

function strategyKey(
  strategy: MemoryRetrievalCandidateStrategy,
): keyof E2EPairedCandidateStageAccumulator['strategyCounts'] {
  return strategy === 'not_requested' ? 'notRequested' : strategy;
}

function similarityOutcomeKey(
  outcome: MemoryRetrievalLocalSimilarityOutcome,
): keyof E2EPairedCandidateStageAccumulator['localSimilarityOutcomeCounts'] {
  return outcome === 'not_requested' ? 'notRequested' : outcome;
}

export function validateAndAccumulateE2EPairedCandidateStages(input: {
  candidates: unknown;
  candidateFactCount: number;
  factRecallMs: number;
  accumulator: E2EPairedCandidateStageAccumulator;
}): MemoryRetrievalCandidateStrategy {
  const candidates = normalizeCandidateStages(input.candidates);
  validateCandidateStages(candidates, input.candidateFactCount, input.factRecallMs);
  const strategy = strategyKey(candidates.strategy);
  input.accumulator.strategyCounts[strategy] = addBounded(
    input.accumulator.strategyCounts[strategy],
    1,
    `candidateStages.strategyCounts.${strategy}`,
  );
  const similarityOutcome = similarityOutcomeKey(candidates.localSimilarityOutcome);
  input.accumulator.localSimilarityOutcomeCounts[similarityOutcome] = addBounded(
    input.accumulator.localSimilarityOutcomeCounts[similarityOutcome],
    1,
    `candidateStages.localSimilarityOutcomeCounts.${similarityOutcome}`,
  );
  for (const key of Object.keys(input.accumulator.totals) as Array<
    keyof E2EPairedCandidateStageAccumulator['totals']
  >) {
    input.accumulator.totals[key] = addBounded(
      input.accumulator.totals[key],
      candidates[key],
      `candidateStages.totals.${key}`,
    );
  }
  input.accumulator.unionMsMax = Math.max(input.accumulator.unionMsMax, candidates.unionMs);
  return candidates.strategy;
}

export function projectE2EPairedCandidateStages(
  accumulator: E2EPairedCandidateStageAccumulator,
): E2EPairedPublicCandidateStages {
  return {
    strategyCounts: { ...accumulator.strategyCounts },
    localSimilarityOutcomeCounts: { ...accumulator.localSimilarityOutcomeCounts },
    totals: { ...accumulator.totals },
    unionMsMax: accumulator.unionMsMax,
  };
}
