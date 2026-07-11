// ---------------------------------------------------------------------------
// Tests — Memory ranking helpers
// ---------------------------------------------------------------------------

import { exponentialDecayMultiplier } from '../../../src/services/memory/ranking/scoring';
import { cosineSimilarity } from '../../../src/services/memory/ranking/similarity';

describe('memory ranking helpers', () => {
  it('keeps cosine similarity behavior stable', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('uses exponential half-life decay for fact recall scoring', () => {
    expect(exponentialDecayMultiplier({ ageInDays: 0, halfLifeDays: 7 })).toBe(1);
    expect(exponentialDecayMultiplier({ ageInDays: 7, halfLifeDays: 7 })).toBeCloseTo(0.5);
  });
});
