// ---------------------------------------------------------------------------
// Tests — Hybrid Search
// ---------------------------------------------------------------------------

import {
  buildFtsQuery,
  bm25RankToScore,
  mergeHybridResults,
} from '../../src/services/memory/hybrid';

describe('buildFtsQuery', () => {
  it('returns null for empty string', () => {
    expect(buildFtsQuery('')).toBeNull();
  });

  it('returns null for only punctuation', () => {
    expect(buildFtsQuery('!!! ---')).toBeNull();
  });

  it('wraps tokens in quotes with AND', () => {
    const result = buildFtsQuery('hello world');
    expect(result).toBe('"hello" AND "world"');
  });

  it('strips quotes from tokens', () => {
    const result = buildFtsQuery('"hello" "world"');
    expect(result).toBe('"hello" AND "world"');
  });

  it('handles unicode words', () => {
    const result = buildFtsQuery('café résumé');
    expect(result).toBe('"café" AND "résumé"');
  });
});

describe('bm25RankToScore', () => {
  it('converts rank 0 to 1/1001-ish', () => {
    expect(bm25RankToScore(0)).toBeCloseTo(1 / (1 + 0), 5);
  });

  it('converts negative rank (higher relevance) to high score', () => {
    // rank = -10 → relevance = 10 → 10 / (1 + 10) ≈ 0.909
    expect(bm25RankToScore(-10)).toBeCloseTo(10 / 11, 3);
  });

  it('converts positive rank to low score', () => {
    expect(bm25RankToScore(999)).toBeCloseTo(1 / 1000, 3);
  });

  it('handles NaN gracefully', () => {
    expect(bm25RankToScore(NaN)).toBeCloseTo(1 / 1000, 3);
  });
});

describe('mergeHybridResults', () => {
  it('merges vector and keyword results', async () => {
    const vector = [
      {
        id: 'a',
        path: 'a.ts',
        startLine: 1,
        endLine: 5,
        source: 'code',
        snippet: 'aaa',
        vectorScore: 0.9,
      },
    ];
    const keyword = [
      {
        id: 'b',
        path: 'b.ts',
        startLine: 1,
        endLine: 5,
        source: 'code',
        snippet: 'bbb',
        textScore: 0.8,
      },
    ];

    const result = await mergeHybridResults({
      vector,
      keyword,
      vectorWeight: 0.5,
      textWeight: 0.5,
    });

    expect(result).toHaveLength(2);
    // First should be a (0.5*0.9 + 0.5*0 = 0.45) vs b (0.5*0 + 0.5*0.8 = 0.4)
    expect(result[0].path).toBe('a.ts');
    expect(result[1].path).toBe('b.ts');
  });

  it('combines scores for overlapping ids', async () => {
    const vector = [
      {
        id: 'x',
        path: 'x.ts',
        startLine: 1,
        endLine: 5,
        source: 'code',
        snippet: 'xxx',
        vectorScore: 0.8,
      },
    ];
    const keyword = [
      {
        id: 'x',
        path: 'x.ts',
        startLine: 1,
        endLine: 5,
        source: 'code',
        snippet: 'xxx',
        textScore: 0.6,
      },
    ];

    const result = await mergeHybridResults({
      vector,
      keyword,
      vectorWeight: 0.5,
      textWeight: 0.5,
    });

    expect(result).toHaveLength(1);
    expect(result[0].score).toBeCloseTo(0.5 * 0.8 + 0.5 * 0.6, 5);
  });

  it('sorts by score descending', async () => {
    const vector = [
      {
        id: 'low',
        path: 'l.ts',
        startLine: 1,
        endLine: 1,
        source: 'code',
        snippet: 'l',
        vectorScore: 0.1,
      },
      {
        id: 'high',
        path: 'h.ts',
        startLine: 1,
        endLine: 1,
        source: 'code',
        snippet: 'h',
        vectorScore: 0.9,
      },
    ];

    const result = await mergeHybridResults({
      vector,
      keyword: [],
      vectorWeight: 1,
      textWeight: 0,
    });

    expect(result[0].path).toBe('h.ts');
    expect(result[1].path).toBe('l.ts');
  });

  it('returns empty for no results', async () => {
    const result = await mergeHybridResults({
      vector: [],
      keyword: [],
      vectorWeight: 0.5,
      textWeight: 0.5,
    });
    expect(result).toEqual([]);
  });
});
