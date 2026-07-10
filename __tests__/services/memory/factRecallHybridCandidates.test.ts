import type { MemoryEntity } from '../../../src/services/memory/entities';
import { buildRecallCandidateSet } from '../../../src/services/memory/factRecallHybridCandidates';
import type { MemoryFact } from '../../../src/services/memory/facts/types';

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
    embedding: null,
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
      localSemanticOutcome: 'not_requested',
    });
  });

  it('unions entity, temporal, and compatible semantic lanes with bounded provenance', () => {
    const lexical = fact('lexical');
    const entityOnly = fact('entity-only', { updatedAt: 3 });
    const semanticOnly = fact('semantic-only', {
      subjectId: 'entity-2',
      embedding: [1, 0],
      updatedAt: 2,
    });
    const result = buildRecallCandidateSet({
      strategy: 'hybrid',
      query: 'Aurora 1970',
      queryUnits: new Set(['aurora', '1970']),
      anchorUnitSets: [],
      lexicalCandidates: [lexical],
      candidateUnitHits: new Map([['lexical', new Set(['1970'])]]),
      eligibleFacts: [entityOnly, semanticOnly, lexical],
      entities: [entity],
      localSemantic: { queryEmbedding: [1, 0], minimumSimilarity: 0.9 },
      limit: 8,
    });

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(
      expect.arrayContaining(['lexical', 'entity-only', 'semantic-only']),
    );
    expect(result.provenanceByFactId.get('entity-only')?.reasons).toEqual(['entity', 'temporal']);
    expect(result.provenanceByFactId.get('semantic-only')?.reasons).toContain('local_semantic');
    expect(result.telemetry).toMatchObject({
      strategy: 'hybrid',
      eligibleScanCount: 3,
      lexicalCount: 1,
      entityCount: 2,
      temporalCount: 3,
      localSemanticCount: 1,
      localSemanticOutcome: 'applied',
      unionCount: 3,
    });
  });
});
