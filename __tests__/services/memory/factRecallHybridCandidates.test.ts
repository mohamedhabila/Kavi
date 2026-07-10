import type { MemoryEntity } from '../../../src/services/memory/entities';
import { buildRecallCandidateSet } from '../../../src/services/memory/factRecallHybridCandidates';
import type { MemoryFact } from '../../../src/services/memory/facts/types';
import { createCurrentLocalSimilarityVector } from '../../../src/services/memory/localSimilarity';

function fact(id: string, overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id,
    subjectId: 'entity-1',
    objectEntityId: null,
    pinned: false,
    updatedAt: 1,
    createdAt: 1,
    validAt: 1,
    importance: 0.5,
    localSimilarity: null,
    sourceRunId: null,
    originTaskId: null,
    taskId: null,
    sourceTurnId: null,
    originConversationId: null,
    originThreadId: null,
    memoryKind: 'semantic_fact',
    predicate: 'state',
    ...overrides,
  } as MemoryFact;
}

const entity: MemoryEntity = {
  id: 'entity-1',
  canonicalName: 'Aurora',
  type: 'project',
  aliases: [],
  attributes: {},
  firstSeenAt: 1,
  lastSeenAt: 1,
  deletedAt: null,
};

describe('hybrid recall candidate set', () => {
  it('keeps lexical ablation candidates and order unchanged', () => {
    const first = fact('first');
    const second = fact('second', { pinned: true });
    const result = buildRecallCandidateSet({
      strategy: 'lexical',
      query: 'quoted aurora',
      queryUnits: new Set(['quoted', 'aurora']),
      anchorUnitSets: [new Set(['quoted'])],
      lexicalCandidates: [first, second],
      candidateUnitHits: new Map([
        ['first', new Set(['quoted'])],
        ['second', new Set(['aurora'])],
      ]),
      eligibleFacts: [],
      entities: [],
      limit: 8,
    });

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['first', 'second']);
    expect(result.provenanceByFactId.get('first')?.reasons).toEqual(['exact_quoted', 'lexical']);
    expect(result.telemetry).toMatchObject({
      strategy: 'lexical',
      pinnedCount: 1,
      exactQuotedCount: 1,
      lexicalCount: 2,
      entityCount: 0,
      temporalCount: 0,
      localSimilarityOutcome: 'not_requested',
    });
  });

  it('unions entity, temporal, and compatible local-similarity lanes with bounded provenance', () => {
    const lexical = fact('lexical');
    const entityOnly = fact('entity-only', { updatedAt: 3 });
    const queryVector = createCurrentLocalSimilarityVector('violet release cipher');
    const similarityOnly = fact('similarity-only', {
      subjectId: 'entity-2',
      localSimilarity: queryVector,
      updatedAt: 2,
    });
    const result = buildRecallCandidateSet({
      strategy: 'hybrid',
      query: 'Aurora 1970',
      queryUnits: new Set(['aurora', '1970']),
      anchorUnitSets: [],
      lexicalCandidates: [lexical],
      candidateUnitHits: new Map([['lexical', new Set(['1970'])]]),
      eligibleFacts: [entityOnly, similarityOnly, lexical],
      entities: [entity],
      localSimilarity: { queryVector, minimumSimilarity: 0.99 },
      limit: 8,
    });

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(
      expect.arrayContaining(['lexical', 'entity-only', 'similarity-only']),
    );
    expect(result.provenanceByFactId.get('entity-only')?.reasons).toEqual(['entity', 'temporal']);
    expect(result.provenanceByFactId.get('similarity-only')?.reasons).toContain('local_similarity');
    expect(result.telemetry).toMatchObject({
      strategy: 'hybrid',
      eligibleScanCount: 3,
      lexicalCount: 1,
      entityCount: 2,
      temporalCount: 3,
      localSimilarityCount: 1,
      localSimilarityOutcome: 'applied',
      unionCount: 3,
    });
  });

  it('reports the exact bounded pinned and quoted lane inputs used by fusion', () => {
    const candidates = Array.from({ length: 80 }, (_, index) =>
      fact(`fact-${index}`, { pinned: true }),
    );
    const result = buildRecallCandidateSet({
      strategy: 'hybrid',
      query: 'quoted',
      queryUnits: new Set(['quoted']),
      anchorUnitSets: [new Set(['quoted'])],
      lexicalCandidates: candidates,
      candidateUnitHits: new Map(
        candidates.map((candidate) => [candidate.id, new Set(['quoted'])]),
      ),
      eligibleFacts: [],
      entities: [],
      limit: 128,
    });

    expect(result.telemetry).toMatchObject({
      pinnedCount: 64,
      exactQuotedCount: 24,
      lexicalCount: 80,
      unionCount: 80,
    });
  });
});
