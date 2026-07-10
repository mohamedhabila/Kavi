import type { MemoryEntity } from './entities';
import {
  RECALL_CANDIDATE_LIMITS,
  type RecallLocalSemanticInput,
  type RecallLocalSemanticOutcome,
} from './factRecallCandidateContract';
import type { RecallCandidateLaneEntry } from './factRecallCandidateUnion';
import type { MemoryFact } from './facts/types';
import { tokenizeLexicalUnits } from './ranking/lexical';
import { cosineSimilarity } from './ranking/similarity';

const TEMPORAL_SIGNAL_PATTERN =
  /(?:\b(?:current(?:ly)?|now|today|latest|recent(?:ly)?|previous|yesterday|earlier|before|past|former|used\s+to)\b|\blast\s+(?:time|day|week|month|year)\b|الحالي|حاليًا|الآن|اليوم|الأحدث|مؤخرًا|السابق|أمس|aktuell|jetzt|heute|neueste|kürzlich|vorherige|gestern|actual|ahora|hoy|últim[oa]|reciente|anterior|ayer|actuel|maintenant|aujourd'hui|dernier|récent|précédent|hier|現在|今|今日|最新|最近|以前|昨日|atual|agora|hoje|últim[oa]|recente|anterior|ontem|当前|當前|现在|今天|最新|最近|以前|昨天)/iu;
const YEAR_PATTERN = /(?:^|[^\p{N}])((?:19|20)\d{2})(?=$|[^\p{N}])/gu;

export interface SupplementalRecallCandidateLanes {
  entity: RecallCandidateLaneEntry[];
  temporal: RecallCandidateLaneEntry[];
  localSemantic: RecallCandidateLaneEntry[];
  localSemanticOutcome: RecallLocalSemanticOutcome;
}

function compareFacts(left: MemoryFact, right: MemoryFact): number {
  if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt;
  if (right.importance !== left.importance) return right.importance - left.importance;
  return left.id.localeCompare(right.id);
}

export function hasTemporalRecallSignal(query: string): boolean {
  YEAR_PATTERN.lastIndex = 0;
  return TEMPORAL_SIGNAL_PATTERN.test(query.normalize('NFKC')) || YEAR_PATTERN.test(query);
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
  if (normalizedQuery.includes(entity.id.normalize('NFKC').toLocaleLowerCase())) return true;
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
  const normalizedQuery = query.normalize('NFKC').toLocaleLowerCase();
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
  if (!hasTemporalRecallSignal(query)) return [];
  const years = extractTemporalRecallYears(query);
  return facts
    .filter((fact) => factMatchesYear(fact, years))
    .sort(compareFacts)
    .slice(0, RECALL_CANDIDATE_LIMITS.temporalLane)
    .map((fact) => ({ fact }));
}

function validEmbedding(values: ReadonlyArray<number>): boolean {
  return (
    values.length > 0 &&
    values.length <= RECALL_CANDIDATE_LIMITS.maximumEmbeddingDimensions &&
    values.every((value) => Number.isFinite(value))
  );
}

function localSemanticLane(
  facts: ReadonlyArray<MemoryFact>,
  input: RecallLocalSemanticInput | undefined,
): {
  entries: RecallCandidateLaneEntry[];
  outcome: RecallLocalSemanticOutcome;
} {
  if (!input) return { entries: [], outcome: 'not_requested' };
  if (!validEmbedding(input.queryEmbedding)) return { entries: [], outcome: 'unavailable' };
  const compatibleFacts = facts.filter(
    (fact) =>
      Array.isArray(fact.embedding) &&
      fact.embedding.length === input.queryEmbedding.length &&
      validEmbedding(fact.embedding),
  );
  if (compatibleFacts.length === 0) return { entries: [], outcome: 'unavailable' };
  const minimumSimilarity = Math.max(0, Math.min(input.minimumSimilarity ?? 0.55, 1));
  const entries = compatibleFacts
    .map((fact) => ({
      fact,
      semanticSimilarity: cosineSimilarity([...input.queryEmbedding], fact.embedding ?? []),
    }))
    .filter((entry) => entry.semanticSimilarity >= minimumSimilarity)
    .sort(
      (left, right) =>
        right.semanticSimilarity - left.semanticSimilarity || compareFacts(left.fact, right.fact),
    )
    .slice(0, RECALL_CANDIDATE_LIMITS.localSemanticLane);
  return { entries, outcome: 'applied' };
}

export function buildSupplementalRecallCandidateLanes(input: {
  query: string;
  queryUnits: ReadonlySet<string>;
  eligibleFacts: ReadonlyArray<MemoryFact>;
  entities: ReadonlyArray<MemoryEntity>;
  localSemantic?: RecallLocalSemanticInput;
}): SupplementalRecallCandidateLanes {
  const semantic = localSemanticLane(input.eligibleFacts, input.localSemantic);
  return {
    entity: entityLane(input.eligibleFacts, input.entities, input.queryUnits, input.query),
    temporal: temporalLane(input.eligibleFacts, input.query),
    localSemantic: semantic.entries,
    localSemanticOutcome: semantic.outcome,
  };
}
