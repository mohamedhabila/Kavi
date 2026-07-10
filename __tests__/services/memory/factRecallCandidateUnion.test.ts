import {
  fuseRecallCandidateLanes,
  recallCandidateDiversityKey,
} from '../../../src/services/memory/factRecallCandidateUnion';
import type { MemoryFact } from '../../../src/services/memory/facts/types';

function fact(id: string, updatedAt: number, overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id,
    updatedAt,
    sourceRunId: null,
    originTaskId: null,
    taskId: null,
    sourceTurnId: null,
    originConversationId: null,
    originThreadId: null,
    memoryKind: 'semantic_fact',
    subjectId: 'subject',
    predicate: 'state',
    ...overrides,
  } as MemoryFact;
}

describe('hybrid recall candidate fusion', () => {
  it('fuses ranked lanes with closed multi-reason provenance deterministically', () => {
    const first = fact('fact-a', 1);
    const second = fact('fact-b', 2);
    const result = fuseRecallCandidateLanes(
      [
        { reason: 'lexical', entries: [{ fact: second }, { fact: first }] },
        { reason: 'entity', entries: [{ fact: first }, { fact: second }] },
        {
          reason: 'local_semantic',
          entries: [{ fact: first, semanticSimilarity: 0.91 }],
        },
      ],
      8,
    );

    expect(result.unionCount).toBe(2);
    expect(result.candidates.map((candidate) => candidate.fact.id)).toEqual(['fact-a', 'fact-b']);
    expect(result.candidates[0]?.provenance).toEqual({
      reasons: ['lexical', 'entity', 'local_semantic'],
      fusionScore: 1,
      semanticSimilarity: 0.91,
    });
  });

  it('uses a diversity-first pass before filling remaining capacity', () => {
    const runAFirst = fact('run-a-1', 3, { sourceRunId: 'run-a' });
    const runASecond = fact('run-a-2', 2, { sourceRunId: 'run-a' });
    const runB = fact('run-b', 1, { sourceRunId: 'run-b' });
    const result = fuseRecallCandidateLanes(
      [
        {
          reason: 'lexical',
          entries: [{ fact: runAFirst }, { fact: runASecond }, { fact: runB }],
        },
      ],
      2,
    );

    expect(result.diversifiedCount).toBe(2);
    expect(result.candidates.map((candidate) => candidate.fact.id)).toEqual(['run-a-1', 'run-b']);
    expect(recallCandidateDiversityKey(runAFirst)).toBe('run:run-a');
  });

  it('deduplicates lane entries and enforces the requested union bound', () => {
    const facts = Array.from({ length: 20 }, (_, index) => fact(`fact-${index}`, index));
    const result = fuseRecallCandidateLanes(
      [
        { reason: 'lexical', entries: facts.map((entry) => ({ fact: entry })) },
        { reason: 'entity', entries: [{ fact: facts[0] }, { fact: facts[0] }] },
      ],
      5,
    );

    expect(result.unionCount).toBe(20);
    expect(result.candidates).toHaveLength(5);
    expect(new Set(result.candidates.map((candidate) => candidate.fact.id)).size).toBe(5);
  });
});
