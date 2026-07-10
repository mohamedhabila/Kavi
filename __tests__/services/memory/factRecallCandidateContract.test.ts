import {
  RECALL_CANDIDATE_LIMITS,
  RECALL_CANDIDATE_REASON_CODES,
  RECALL_CANDIDATE_STRATEGIES,
  RECALL_LOCAL_SEMANTIC_OUTCOMES,
} from '../../../src/services/memory/factRecallCandidateContract';

describe('hybrid recall candidate contract', () => {
  it('keeps strategies, provenance reasons, and semantic outcomes closed', () => {
    expect(RECALL_CANDIDATE_STRATEGIES).toEqual(['lexical', 'hybrid']);
    expect(RECALL_CANDIDATE_REASON_CODES).toEqual([
      'pinned',
      'exact_quoted',
      'lexical',
      'entity',
      'temporal',
      'local_semantic',
    ]);
    expect(RECALL_LOCAL_SEMANTIC_OUTCOMES).toEqual(['not_requested', 'unavailable', 'applied']);
  });

  it('freezes mobile-safe candidate, scan, lane, and embedding bounds', () => {
    expect(Object.isFrozen(RECALL_CANDIDATE_LIMITS)).toBe(true);
    expect(RECALL_CANDIDATE_LIMITS).toEqual({
      defaultUnion: 128,
      maximumUnion: 2_000,
      defaultEligibleScan: 256,
      maximumEligibleScan: 500,
      pinnedLane: 64,
      exactQuotedLane: 24,
      entityLane: 32,
      temporalLane: 24,
      localSemanticLane: 32,
      maximumEmbeddingDimensions: 2_048,
      reciprocalRankConstant: 60,
    });
  });
});
