import { rankSourceCoherentEntries } from '../../../src/services/memory/factRecallSourceCoherence';
import type { MemoryFact, MemoryFactKind } from '../../../src/services/memory/facts/types';
import type { ScoredFact } from '../../../src/services/memory/factRecallTypes';

function fact(params: {
  id: string;
  sourceRunId?: string;
  memoryKind?: MemoryFactKind;
  stateIndex?: number;
}): MemoryFact {
  return {
    id: params.id,
    sourceRunId: params.sourceRunId ?? null,
    memoryKind: params.memoryKind ?? 'procedure',
    attributes:
      typeof params.stateIndex === 'number' ? { stateIndex: params.stateIndex } : {},
    objectText: '{}',
  } as MemoryFact;
}

function scored(params: {
  id: string;
  score: number;
  relevanceScore?: number;
  quotedUiControlBoost?: number;
  sourceRunId?: string;
  memoryKind?: MemoryFactKind;
  stateIndex?: number;
}): ScoredFact {
  return {
    fact: fact(params),
    score: params.score,
    textScore: params.score,
    lexicalScore: params.score,
    relevanceScore: params.relevanceScore ?? params.score,
    pinnedBoost: 0,
    decayMultiplier: 1,
    scopeBoost: 0,
    reinforcementBoost: 0,
    importanceScore: 0,
    retrievabilityScore: 1,
    quotedUiControlBoost: params.quotedUiControlBoost ?? 0,
    surfaceLabelBoost: 0,
    surfaceIdentityScore: 0,
    visibleTextEvidenceBoost: 0,
  };
}

describe('rankSourceCoherentEntries', () => {
  it('prefers fragmented evidence from one source run over an isolated broad match', () => {
    const ordered = rankSourceCoherentEntries([
      scored({ id: 'single', sourceRunId: 'run-single', score: 0.7 }),
      scored({ id: 'target-a', sourceRunId: 'run-target', score: 0.5, stateIndex: 1 }),
      scored({
        id: 'target-b',
        sourceRunId: 'run-target',
        memoryKind: 'ui_inventory',
        score: 0.45,
        stateIndex: 2,
      }),
      scored({
        id: 'target-c',
        sourceRunId: 'run-target',
        memoryKind: 'outcome',
        score: 0.4,
        stateIndex: 3,
      }),
    ]);

    expect(ordered[0].fact.sourceRunId).toBe('run-target');
  });

  it('keeps a stronger standalone memory ahead of weak source-run support', () => {
    const ordered = rankSourceCoherentEntries([
      scored({ id: 'single', sourceRunId: 'run-single', score: 0.9 }),
      scored({ id: 'weak-a', sourceRunId: 'run-weak', score: 0.35, stateIndex: 1 }),
      scored({
        id: 'weak-b',
        sourceRunId: 'run-weak',
        memoryKind: 'ui_inventory',
        score: 0.3,
        stateIndex: 2,
      }),
    ]);

    expect(ordered[0].fact.id).toBe('single');
  });

  it('keeps actionable outcome evidence ahead of lower-level support bundles', () => {
    const ordered = rankSourceCoherentEntries([
      scored({ id: 'support-procedure', sourceRunId: 'run-support', score: 0.58 }),
      scored({
        id: 'support-ui',
        sourceRunId: 'run-support',
        memoryKind: 'ui_inventory',
        score: 0.24,
      }),
      scored({
        id: 'action-result',
        sourceRunId: 'run-action',
        memoryKind: 'outcome',
        score: 0.56,
      }),
    ]);

    expect(ordered[0].fact.id).toBe('action-result');
  });

  it('uses relevance before total boost when comparing source groups', () => {
    const ordered = rankSourceCoherentEntries([
      scored({
        id: 'boosted-ui',
        sourceRunId: 'run-boosted-ui',
        memoryKind: 'ui_inventory',
        score: 0.7,
        relevanceScore: 0.09,
      }),
      scored({
        id: 'relevant-outcome',
        sourceRunId: 'run-relevant-outcome',
        memoryKind: 'outcome',
        score: 0.58,
        relevanceScore: 0.19,
      }),
    ]);

    expect(ordered[0].fact.id).toBe('relevant-outcome');
  });

  it('treats exact quoted UI action matches as source-coherence evidence', () => {
    const ordered = rankSourceCoherentEntries([
      scored({
        id: 'broad-a',
        sourceRunId: 'run-broad',
        score: 0.36,
        relevanceScore: 0.28,
        stateIndex: 1,
      }),
      scored({
        id: 'broad-b',
        sourceRunId: 'run-broad',
        memoryKind: 'ui_inventory',
        score: 0.32,
        relevanceScore: 0.24,
        stateIndex: 2,
      }),
      scored({
        id: 'exact-action',
        sourceRunId: 'run-exact-action',
        memoryKind: 'outcome',
        score: 0.5,
        relevanceScore: 0.08,
        quotedUiControlBoost: 0.4,
        stateIndex: 8,
      }),
    ]);

    expect(ordered[0].fact.id).toBe('exact-action');
  });
});
