// ---------------------------------------------------------------------------
// Tests — Memory ranking helpers
// ---------------------------------------------------------------------------

import {
  chunkMatchesSearchOptions,
  createArrayChunkIndex,
  dedupeSearchResultsBySnippetPrefix,
  searchChunkIndex,
} from '../../../src/services/memory/ranking/chunkIndex';
import {
  combineHybridScore,
  exponentialDecayMultiplier,
} from '../../../src/services/memory/ranking/scoring';
import { cosineSimilarity } from '../../../src/services/memory/ranking/similarity';

describe('memory ranking helpers', () => {
  it('keeps cosine similarity behavior stable', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('combines hybrid score components with caller-provided weights', () => {
    expect(
      combineHybridScore({
        vectorScore: 0.8,
        textScore: 0.5,
        temporalScore: 0.25,
        vectorWeight: 0.6,
        textWeight: 0.3,
        temporalWeight: 0.1,
      }),
    ).toBeCloseTo(0.655);
  });

  it('uses exponential half-life decay for fact recall scoring', () => {
    expect(exponentialDecayMultiplier({ ageInDays: 0, halfLifeDays: 7 })).toBe(1);
    expect(exponentialDecayMultiplier({ ageInDays: 7, halfLifeDays: 7 })).toBeCloseTo(0.5);
  });

  it('matches chunk scope filters used by sqlite search', () => {
    const globalChunk = {
      source: 'MEMORY.md',
      content: 'global',
      timestamp: 1,
      scope: 'global' as const,
    };
    const dailyChunk = {
      source: 'daily.md',
      content: 'daily',
      timestamp: 1,
      scope: 'daily' as const,
    };
    const conversationChunk = {
      source: 'conversation/MEMORY.md',
      content: 'scoped',
      timestamp: 1,
      scope: 'conversation' as const,
      conversationId: 'conv-1',
    };

    expect(chunkMatchesSearchOptions(globalChunk, { scope: 'global' })).toBe(true);
    expect(chunkMatchesSearchOptions(dailyChunk, { scope: 'global' })).toBe(true);
    expect(chunkMatchesSearchOptions(conversationChunk, { scope: 'global' })).toBe(false);
    expect(
      chunkMatchesSearchOptions(conversationChunk, {
        scope: 'conversation',
        conversationId: 'conv-1',
      }),
    ).toBe(true);
    expect(
      chunkMatchesSearchOptions(conversationChunk, {
        scope: 'conversation',
        conversationId: 'conv-2',
      }),
    ).toBe(false);
  });

  it('scores, sorts, and dedupes chunk-index results by snippet prefix', async () => {
    const results = await searchChunkIndex({
      index: createArrayChunkIndex([
        { source: 'a', content: 'same duplicated prefix body', timestamp: 1, scope: 'global' },
        { source: 'b', content: 'same duplicated prefix body', timestamp: 1, scope: 'global' },
        { source: 'c', content: 'unique body', timestamp: 1, scope: 'global' },
      ]),
      queryEmbedding: null,
      vectorWeight: 0,
      textWeight: 1,
      temporalWeight: 0,
      maxResults: 3,
      textScore: (chunk) => (chunk.source === 'b' ? 0.9 : chunk.source === 'a' ? 0.8 : 0.7),
      dedupeBySnippetPrefix: true,
      scoreThreshold: 0,
    });

    expect(results.map((result) => result.source)).toEqual(['b', 'c']);
  });

  it('can dedupe result snippets with a caller-selected prefix length', () => {
    expect(
      dedupeSearchResultsBySnippetPrefix(
        [
          { source: 'a', snippet: 'abcdef one', score: 1 },
          { source: 'b', snippet: 'abcdef two', score: 0.9 },
          { source: 'c', snippet: 'uvwxyz', score: 0.8 },
        ],
        10,
        6,
      ).map((result) => result.source),
    ).toEqual(['a', 'c']);
  });
});
