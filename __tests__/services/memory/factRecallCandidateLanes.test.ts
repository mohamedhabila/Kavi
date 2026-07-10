import type { MemoryEntity } from '../../../src/services/memory/entities';
import {
  buildSupplementalRecallCandidateLanes,
  extractTemporalRecallYears,
} from '../../../src/services/memory/factRecallCandidateLanes';
import type { MemoryFact } from '../../../src/services/memory/facts/types';
import {
  createCurrentLocalSimilarityVector,
  LOCAL_SIMILARITY_DIMENSIONS,
  LOCAL_SIMILARITY_MODEL,
} from '../../../src/services/memory/localSimilarity';
import { tokenizeLexicalUnits } from '../../../src/services/memory/ranking/lexical';

function fact(id: string, updatedAt: number, overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id,
    subjectId: 'entity-1',
    objectEntityId: null,
    updatedAt,
    createdAt: updatedAt,
    validAt: updatedAt,
    importance: 0.5,
    localSimilarity: null,
    ...overrides,
  } as MemoryFact;
}

function entity(overrides: Partial<MemoryEntity> = {}): MemoryEntity {
  return {
    id: 'entity-1',
    canonicalName: 'Project Aurora',
    type: 'project',
    aliases: ['Northern Lights'],
    attributes: {},
    firstSeenAt: 1,
    lastSeenAt: 1,
    deletedAt: null,
    ...overrides,
  };
}

describe('supplemental hybrid recall lanes', () => {
  it('extracts language-neutral explicit years without temporal word lists', () => {
    expect(extractTemporalRecallYears('Compare 2022 with 2024')).toEqual(new Set([2022, 2024]));
    expect(extractTemporalRecallYears('last name is Smith')).toEqual(new Set());
  });

  it('matches canonical entities and aliases without exposing unrelated facts', () => {
    const target = fact('target', 2);
    const unrelated = fact('unrelated', 3, { subjectId: 'entity-2' });
    const query = 'What changed for Northern Lights?';
    const lanes = buildSupplementalRecallCandidateLanes({
      query,
      queryUnits: tokenizeLexicalUnits(query),
      eligibleFacts: [unrelated, target],
      entities: [entity(), entity({ id: 'entity-2', canonicalName: 'Other Project', aliases: [] })],
    });

    expect(lanes.entity.map((entry) => entry.fact.id)).toEqual(['target']);
    expect(lanes.temporal.map((entry) => entry.fact.id)).toEqual(['unrelated', 'target']);
    expect(lanes.localSemanticOutcome).toBe('not_requested');
  });

  it('filters temporal candidates to explicit years and deterministic recency order', () => {
    const in2024 = Date.UTC(2024, 1, 1);
    const in2023 = Date.UTC(2023, 1, 1);
    const query = 'What happened in 2024?';
    const lanes = buildSupplementalRecallCandidateLanes({
      query,
      queryUnits: tokenizeLexicalUnits(query),
      eligibleFacts: [
        fact('older-2024', in2024),
        fact('newer-2024', in2024 + 10),
        fact('2023', in2023),
      ],
      entities: [],
    });

    expect(lanes.temporal.map((entry) => entry.fact.id)).toEqual(['newer-2024', 'older-2024']);
  });

  it('applies only compatible finite local vectors and reports absence explicitly', () => {
    const queryVector = createCurrentLocalSimilarityVector('violet release cipher');
    const matching = fact('matching', 1, { localSimilarity: queryVector });
    const weak = fact('weak', 2, {
      localSimilarity: createCurrentLocalSimilarityVector('orange travel schedule'),
    });
    const incompatible = fact('incompatible', 3, {
      localSimilarity: {
        model: LOCAL_SIMILARITY_MODEL,
        dimensions: LOCAL_SIMILARITY_DIMENSIONS,
        values: [1, 0, 0],
      },
    });
    const base = {
      query: 'semantic query',
      queryUnits: tokenizeLexicalUnits('semantic query'),
      eligibleFacts: [weak, incompatible, matching],
      entities: [],
    };

    expect(buildSupplementalRecallCandidateLanes(base).localSemanticOutcome).toBe('not_requested');
    expect(
      buildSupplementalRecallCandidateLanes({
        ...base,
        localSemantic: { queryVector, minimumSimilarity: 0.99 },
      }),
    ).toMatchObject({
      localSemanticOutcome: 'applied',
      localSemantic: [{ fact: { id: 'matching' }, semanticSimilarity: 1 }],
    });
    expect(
      buildSupplementalRecallCandidateLanes({
        ...base,
        localSemantic: { queryVector, minimumSimilarity: Number.NaN },
      }).localSemantic.map((entry) => entry.fact.id),
    ).toEqual(['matching']);
    expect(
      buildSupplementalRecallCandidateLanes({
        ...base,
        eligibleFacts: [incompatible],
        localSemantic: { queryVector },
      }).localSemanticOutcome,
    ).toBe('unavailable');
  });
});
