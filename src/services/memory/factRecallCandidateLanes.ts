import type { MemoryEntity } from './entities';
import {
  RECALL_CANDIDATE_LIMITS,
  type RecallLocalSimilarityInput,
  type RecallLocalSimilarityOutcome,
} from './factRecallCandidateContract';
import type { RecallCandidateLaneEntry } from './factRecallCandidateUnion';
import type { MemoryFact } from './facts/types';
import { tokenizeLexicalUnits } from './ranking/lexical';
import { cosineSimilarity } from './ranking/similarity';
import { isCurrentLocalSimilarityVector } from './localSimilarity';
import {
  isProviderEmbeddingVector,
  providerEmbeddingCosineSimilarity,
  sameProviderEmbeddingModel,
} from './providerSimilarity';

const YEAR_PATTERN = /(?:^|[^\p{N}])((?:19|20)\d{2})(?=$|[^\p{N}])/gu;

export interface SupplementalRecallCandidateLanes {
  entity: RecallCandidateLaneEntry[];
  temporal: RecallCandidateLaneEntry[];
  localSimilarity: RecallCandidateLaneEntry[];
  localSimilarityOutcome: RecallLocalSimilarityOutcome;
}

function compareFacts(left: MemoryFact, right: MemoryFact): number {
  if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt;
  if (right.importance !== left.importance) return right.importance - left.importance;
  return left.id.localeCompare(right.id);
}

export function extractTemporalRecallYears(query: string): ReadonlySet<number> {
  const years = new Set<number>();
  YEAR_PATTERN.lastIndex = 0;
  for (const match of query.matchAll(YEAR_PATTERN)) years.add(Number(match[1]));
  return years;
}

function factMatchesYear(fact: MemoryFact, years: ReadonlySet<number>): boolean {
  if (years.size === 0) return true;
  return [fact.validAt, fact.createdAt, fact.updatedAt].some((timestamp) => {
    if (!Number.isFinite(timestamp) || timestamp < 0) return false;
    return years.has(new Date(timestamp).getUTCFullYear());
  });
}

function entityMatchesQuery(
  entity: MemoryEntity,
  queryUnits: ReadonlySet<string>,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.includes(entity.id.normalize('NFKC').toLowerCase())) return true;
  return [entity.canonicalName, ...entity.aliases].some((label) => {
    const units = tokenizeLexicalUnits(label);
    return units.size > 0 && Array.from(units).every((unit) => queryUnits.has(unit));
  });
}

function entityLane(
  facts: ReadonlyArray<MemoryFact>,
  entities: ReadonlyArray<MemoryEntity>,
  queryUnits: ReadonlySet<string>,
  query: string,
): RecallCandidateLaneEntry[] {
  const normalizedQuery = query.normalize('NFKC').toLowerCase();
  const matchingEntityIds = new Set(
    entities
      .filter((entity) => entity.deletedAt === null)
      .filter((entity) => entityMatchesQuery(entity, queryUnits, normalizedQuery))
      .map((entity) => entity.id),
  );
  if (matchingEntityIds.size === 0) return [];
  return facts
    .filter(
      (fact) =>
        matchingEntityIds.has(fact.subjectId) ||
        Boolean(fact.objectEntityId && matchingEntityIds.has(fact.objectEntityId)),
    )
    .sort(compareFacts)
    .slice(0, RECALL_CANDIDATE_LIMITS.entityLane)
    .map((fact) => ({ fact }));
}

function temporalLane(facts: ReadonlyArray<MemoryFact>, query: string): RecallCandidateLaneEntry[] {
  const years = extractTemporalRecallYears(query);
  return facts
    .filter((fact) => factMatchesYear(fact, years))
    .sort(compareFacts)
    .slice(0, RECALL_CANDIDATE_LIMITS.temporalLane)
    .map((fact) => ({ fact }));
}

/**
 * Semantic candidate lane. When the caller supplies a compatible provider
 * query vector (resolved once per turn by the memory-access gateway), a
 * same-model provider vector on the fact is the primary similarity signal;
 * the on-device local n-gram vector is always the fallback so retrieval
 * keeps working keyless/offline. Facts may report either, both, or neither
 * score depending on which vectors the maintenance backfill has produced.
 */
function localSimilarityLane(
  facts: ReadonlyArray<MemoryFact>,
  input: RecallLocalSimilarityInput | undefined,
): {
  entries: RecallCandidateLaneEntry[];
  outcome: RecallLocalSimilarityOutcome;
} {
  if (!input) return { entries: [], outcome: 'not_requested' };
  const localQueryCompatible = isCurrentLocalSimilarityVector(input.queryVector);
  const providerQueryVector = input.providerQueryVector;
  const providerQueryCompatible =
    providerQueryVector !== undefined && isProviderEmbeddingVector(providerQueryVector);
  if (!localQueryCompatible && !providerQueryCompatible) {
    return { entries: [], outcome: 'unavailable' };
  }
  const requestedMinimum = input.minimumSimilarity;
  const minimumSimilarity = Number.isFinite(requestedMinimum ?? NaN)
    ? Math.max(0, Math.min(requestedMinimum ?? 0.55, 1))
    : 0.55;

  interface ScoredSemanticCandidate {
    fact: MemoryFact;
    localSimilarityScore?: number;
    providerSimilarityScore?: number;
    primaryScore: number;
  }

  const scored: ScoredSemanticCandidate[] = [];
  for (const fact of facts) {
    let providerSimilarityScore: number | undefined;
    if (
      providerQueryCompatible &&
      fact.providerEmbedding &&
      isProviderEmbeddingVector(fact.providerEmbedding) &&
      sameProviderEmbeddingModel(providerQueryVector, fact.providerEmbedding)
    ) {
      providerSimilarityScore = providerEmbeddingCosineSimilarity(
        providerQueryVector,
        fact.providerEmbedding,
      );
    }
    let localSimilarityScore: number | undefined;
    if (
      localQueryCompatible &&
      fact.localSimilarity &&
      isCurrentLocalSimilarityVector(fact.localSimilarity)
    ) {
      localSimilarityScore = cosineSimilarity(input.queryVector.values, fact.localSimilarity.values);
    }
    if (providerSimilarityScore === undefined && localSimilarityScore === undefined) continue;
    const primaryScore = providerSimilarityScore ?? localSimilarityScore!;
    if (primaryScore < minimumSimilarity) continue;
    scored.push({
      fact,
      ...(localSimilarityScore !== undefined ? { localSimilarityScore } : {}),
      ...(providerSimilarityScore !== undefined ? { providerSimilarityScore } : {}),
      primaryScore,
    });
  }
  if (scored.length === 0) return { entries: [], outcome: 'unavailable' };
  scored.sort(
    (left, right) => right.primaryScore - left.primaryScore || compareFacts(left.fact, right.fact),
  );
  const entries = scored
    .slice(0, RECALL_CANDIDATE_LIMITS.localSimilarityLane)
    .map(({ fact, localSimilarityScore, providerSimilarityScore }) => ({
      fact,
      ...(localSimilarityScore !== undefined ? { localSimilarityScore } : {}),
      ...(providerSimilarityScore !== undefined ? { providerSimilarityScore } : {}),
    }));
  return { entries, outcome: 'applied' };
}

export function buildSupplementalRecallCandidateLanes(input: {
  query: string;
  queryUnits: ReadonlySet<string>;
  eligibleFacts: ReadonlyArray<MemoryFact>;
  entities: ReadonlyArray<MemoryEntity>;
  localSimilarity?: RecallLocalSimilarityInput;
}): SupplementalRecallCandidateLanes {
  const similarity = localSimilarityLane(input.eligibleFacts, input.localSimilarity);
  return {
    entity: entityLane(input.eligibleFacts, input.entities, input.queryUnits, input.query),
    temporal: temporalLane(input.eligibleFacts, input.query),
    localSimilarity: similarity.entries,
    localSimilarityOutcome: similarity.outcome,
  };
}
