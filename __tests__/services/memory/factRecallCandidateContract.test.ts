import {
  RECALL_CANDIDATE_LIMITS,
  RECALL_CANDIDATE_REASON_CODES,
  RECALL_CANDIDATE_STRATEGIES,
  RECALL_LOCAL_SIMILARITY_OUTCOMES,
} from '../../../src/services/memory/factRecallCandidateContract';

describe('hybrid recall candidate contract', () => {
  it('keeps strategies, provenance reasons, and local-similarity outcomes closed', () => {
    expect(RECALL_CANDIDATE_STRATEGIES).toEqual(['lexical', 'hybrid']);
    expect(RECALL_CANDIDATE_REASON_CODES).toEqual([
      'pinned',
      'exact_quoted',
      'lexical',
      'entity',
      'temporal',
      'local_similarity',
    ]);
    expect(RECALL_LOCAL_SIMILARITY_OUTCOMES).toEqual(['not_requested', 'unavailable', 'applied']);
  });

  it('freezes mobile-safe candidate, scan, and lane bounds', () => {
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
      localSimilarityLane: 32,
      reciprocalRankConstant: 60,
    });
  });
});
