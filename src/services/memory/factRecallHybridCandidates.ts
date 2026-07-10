import type { MemoryEntity } from './entities';
import {
  RECALL_CANDIDATE_LIMITS,
  type RecallCandidateProvenance,
  type RecallCandidateStageTelemetry,
  type RecallCandidateStrategy,
  type RecallLocalSimilarityInput,
} from './factRecallCandidateContract';
import { buildSupplementalRecallCandidateLanes } from './factRecallCandidateLanes';
import {
  fuseRecallCandidateLanes,
  type FusedRecallCandidate,
  type RecallCandidateLane,
} from './factRecallCandidateUnion';
import type { MemoryFact } from './facts/types';

export interface RecallCandidateSet {
  candidates: MemoryFact[];
  provenanceByFactId: ReadonlyMap<string, RecallCandidateProvenance>;
  telemetry: RecallCandidateStageTelemetry;
}

const EMPTY_PROVENANCE: RecallCandidateProvenance = Object.freeze({
  reasons: Object.freeze([]),
  fusionScore: 0,
  localSimilarityScore: null,
});

function exactQuotedMatch(
  hits: ReadonlySet<string> | undefined,
  anchorUnitSets: ReadonlyArray<ReadonlySet<string>>,
): boolean {
  if (!hits || anchorUnitSets.length === 0) return false;
  return anchorUnitSets.some(
    (anchorUnits) =>
      anchorUnits.size > 0 && Array.from(anchorUnits).every((unit) => hits.has(unit)),
  );
}

function lexicalCandidateSet(input: {
  candidates: ReadonlyArray<MemoryFact>;
  candidateUnitHits: ReadonlyMap<string, ReadonlySet<string>>;
  anchorUnitSets: ReadonlyArray<ReadonlySet<string>>;
}): RecallCandidateSet {
  const provenanceByFactId = new Map<string, RecallCandidateProvenance>();
  let pinnedCount = 0;
  let exactQuotedCount = 0;
  let lexicalCount = 0;
  for (const fact of input.candidates) {
    const hits = input.candidateUnitHits.get(fact.id);
    const reasons: RecallCandidateProvenance['reasons'][number][] = [];
    if (fact.pinned) {
      reasons.push('pinned');
      pinnedCount += 1;
    }
    if (exactQuotedMatch(hits, input.anchorUnitSets)) {
      reasons.push('exact_quoted');
      exactQuotedCount += 1;
    }
    if (hits && hits.size > 0) {
      reasons.push('lexical');
      lexicalCount += 1;
    }
    provenanceByFactId.set(
      fact.id,
      reasons.length > 0
        ? { reasons, fusionScore: 0, localSimilarityScore: null }
        : EMPTY_PROVENANCE,
    );
  }
  return {
    candidates: [...input.candidates],
    provenanceByFactId,
    telemetry: {
      strategy: 'lexical',
      localSimilarityOutcome: 'not_requested',
      eligibleScanCount: 0,
      pinnedCount,
      exactQuotedCount,
      lexicalCount,
      entityCount: 0,
      temporalCount: 0,
      localSimilarityCount: 0,
      unionCount: input.candidates.length,
      diversifiedCount: input.candidates.length,
      unionMs: 0,
    },
  };
}

function lane(
  reason: RecallCandidateLane['reason'],
  facts: ReadonlyArray<MemoryFact>,
): RecallCandidateLane {
  return { reason, entries: facts.map((fact) => ({ fact })) };
}

export function buildRecallCandidateSet(input: {
  strategy: RecallCandidateStrategy;
  query: string;
  queryUnits: ReadonlySet<string>;
  anchorUnitSets: ReadonlyArray<ReadonlySet<string>>;
  lexicalCandidates: ReadonlyArray<MemoryFact>;
  candidateUnitHits: ReadonlyMap<string, ReadonlySet<string>>;
  eligibleFacts: ReadonlyArray<MemoryFact>;
  entities: ReadonlyArray<MemoryEntity>;
  localSimilarity?: RecallLocalSimilarityInput;
  limit: number;
}): RecallCandidateSet {
  const lexical = lexicalCandidateSet({
    candidates: input.lexicalCandidates,
    candidateUnitHits: input.candidateUnitHits,
    anchorUnitSets: input.anchorUnitSets,
  });
  if (input.strategy === 'lexical') return lexical;

  const startedAt = Date.now();
  const exactFacts = input.lexicalCandidates
    .filter((fact) => exactQuotedMatch(input.candidateUnitHits.get(fact.id), input.anchorUnitSets))
    .slice(0, RECALL_CANDIDATE_LIMITS.exactQuotedLane);
  const lexicalFacts = input.lexicalCandidates.filter(
    (fact) => (input.candidateUnitHits.get(fact.id)?.size ?? 0) > 0,
  );
  const pinnedFacts = input.lexicalCandidates
    .filter((fact) => fact.pinned)
    .slice(0, RECALL_CANDIDATE_LIMITS.pinnedLane);
  const supplemental = buildSupplementalRecallCandidateLanes({
    query: input.query,
    queryUnits: input.queryUnits,
    eligibleFacts: input.eligibleFacts,
    entities: input.entities,
    ...(input.localSimilarity ? { localSimilarity: input.localSimilarity } : {}),
  });
  const fused = fuseRecallCandidateLanes(
    [
      lane('pinned', pinnedFacts),
      lane('exact_quoted', exactFacts),
      lane('lexical', lexicalFacts),
      { reason: 'entity', entries: supplemental.entity },
      { reason: 'temporal', entries: supplemental.temporal },
      { reason: 'local_similarity', entries: supplemental.localSimilarity },
    ],
    input.limit,
  );
  const provenanceByFactId = new Map(
    fused.candidates.map((candidate: FusedRecallCandidate) => [
      candidate.fact.id,
      candidate.provenance,
    ]),
  );
  return {
    candidates: fused.candidates.map((candidate) => candidate.fact),
    provenanceByFactId,
    telemetry: {
      strategy: 'hybrid',
      localSimilarityOutcome: supplemental.localSimilarityOutcome,
      eligibleScanCount: input.eligibleFacts.length,
      pinnedCount: pinnedFacts.length,
      exactQuotedCount: exactFacts.length,
      lexicalCount: lexicalFacts.length,
      entityCount: supplemental.entity.length,
      temporalCount: supplemental.temporal.length,
      localSimilarityCount: supplemental.localSimilarity.length,
      unionCount: fused.unionCount,
      diversifiedCount: fused.diversifiedCount,
      unionMs: Math.max(0, Date.now() - startedAt),
    },
  };
}
