// ---------------------------------------------------------------------------
// Tests — MMR Re-ranking
// ---------------------------------------------------------------------------

import {
  tokenize,
  jaccardSimilarity,
  textSimilarity,
  computeMMRScore,
  mmrRerank,
  applyMMRToHybridResults,
  MMRItem,
} from '../../src/services/memory/mmr';

describe('tokenize', () => {
  it('returns a Set of lowercase tokens', () => {
    const result = tokenize('Hello World');
    expect(result).toEqual(new Set(['hello', 'world']));
  });

  it('returns empty set for no alphanumeric content', () => {
    expect(tokenize('!!! ---')).toEqual(new Set());
  });

  it('includes underscored words', () => {
    expect(tokenize('foo_bar')).toEqual(new Set(['foo_bar']));
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    const s = new Set(['a', 'b']);
    expect(jaccardSimilarity(s, s)).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    expect(jaccardSimilarity(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('returns 1 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
  });

  it('returns 0 when one set is empty', () => {
    expect(jaccardSimilarity(new Set(['a']), new Set())).toBe(0);
  });

  it('computes partial overlap', () => {
    // {a, b} ∩ {b, c} = {b}, union = {a, b, c} → 1/3
    const sim = jaccardSimilarity(new Set(['a', 'b']), new Set(['b', 'c']));
    expect(sim).toBeCloseTo(1 / 3, 5);
  });
});

describe('textSimilarity', () => {
  it('returns 1 for identical text', () => {
    expect(textSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('returns 0 for completely different text', () => {
    expect(textSimilarity('abc', 'xyz')).toBe(0);
  });
});

describe('computeMMRScore', () => {
  it('returns relevance when lambda=1', () => {
    expect(computeMMRScore(0.8, 0.5, 1)).toBe(0.8);
  });

  it('penalizes similarity when lambda<1', () => {
    const score = computeMMRScore(0.8, 0.5, 0.7);
    // 0.7 * 0.8 - 0.3 * 0.5 = 0.56 - 0.15 = 0.41
    expect(score).toBeCloseTo(0.41, 5);
  });
});

describe('mmrRerank', () => {
  const items: MMRItem[] = [
    { id: '1', score: 0.9, content: 'hello world foo' },
    { id: '2', score: 0.85, content: 'hello world bar' },
    { id: '3', score: 0.7, content: 'completely different content xyz' },
  ];

  it('returns copy when not enabled', () => {
    const result = mmrRerank(items, { enabled: false });
    expect(result).toEqual(items);
    expect(result).not.toBe(items); // Copy, not same reference
  });

  it('returns copy for single item', () => {
    const result = mmrRerank([items[0]], { enabled: true });
    expect(result).toHaveLength(1);
  });

  it('returns all items when enabled', () => {
    const result = mmrRerank(items, { enabled: true, lambda: 0.7 });
    expect(result).toHaveLength(3);
  });

  it('may reorder to promote diversity', () => {
    const result = mmrRerank(items, { enabled: true, lambda: 0.5 });
    expect(result).toHaveLength(3);
    // First item should still be highest relevance
    expect(result[0].id).toBe('1');
  });

  it('sorts by score when lambda=1', () => {
    const result = mmrRerank(items, { enabled: true, lambda: 1 });
    expect(result.map((i) => i.id)).toEqual(['1', '2', '3']);
  });
});

describe('applyMMRToHybridResults', () => {
  it('returns empty for empty input', () => {
    expect(applyMMRToHybridResults([], {})).toEqual([]);
  });

  it('maps results to MMRItems and back', () => {
    const results = [
      { score: 0.9, snippet: 'hello', path: 'a.ts', startLine: 1 },
      { score: 0.5, snippet: 'world', path: 'b.ts', startLine: 10 },
    ];
    const reranked = applyMMRToHybridResults(results, { enabled: true, lambda: 0.7 });
    expect(reranked).toHaveLength(2);
    expect(reranked[0].path).toBeDefined();
    expect(reranked[0].snippet).toBeDefined();
  });
});
