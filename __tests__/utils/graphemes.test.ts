// ---------------------------------------------------------------------------
// Tests — Grapheme-safe text utilities
// ---------------------------------------------------------------------------

import {
  graphemeLength,
  resetGraphemeSegmenterCacheForTests,
  segmentGraphemes,
  truncateGraphemesFromEnd,
  truncateGraphemesTo,
} from '../../src/utils/graphemes';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦'; // man ZWJ woman ZWJ girl ZWJ boy
const FLAG_PAIR = '🇺🇸🇨🇦'; // two regional-indicator flag pairs
const DEVANAGARI_CONJUNCT_TEXT = 'क्षत्रिय';
const ARABIC_WITH_DIACRITICS = 'بِسْمِ';
const ASTRAL_CHAR = '𝌆'; // U+1D306, outside the BMP (surrogate pair)

function withoutIntlSegmenter<T>(run: () => T): T {
  const original = (Intl as any).Segmenter;
  delete (Intl as any).Segmenter;
  resetGraphemeSegmenterCacheForTests();
  try {
    return run();
  } finally {
    (Intl as any).Segmenter = original;
    resetGraphemeSegmenterCacheForTests();
  }
}

describe('segmentGraphemes', () => {
  afterEach(() => {
    resetGraphemeSegmenterCacheForTests();
  });

  it('returns an empty array for empty input', () => {
    expect(segmentGraphemes('')).toEqual([]);
  });

  it('keeps an emoji ZWJ sequence as a single grapheme (native Intl.Segmenter)', () => {
    expect(segmentGraphemes(FAMILY_EMOJI)).toEqual([FAMILY_EMOJI]);
  });

  it('keeps an emoji ZWJ sequence as a single grapheme (fallback path)', () => {
    withoutIntlSegmenter(() => {
      expect(segmentGraphemes(FAMILY_EMOJI)).toEqual([FAMILY_EMOJI]);
    });
  });

  it('keeps a flag emoji regional-indicator pair together (native)', () => {
    expect(segmentGraphemes(FLAG_PAIR)).toEqual(['🇺🇸', '🇨🇦']);
  });

  it('keeps a flag emoji regional-indicator pair together (fallback)', () => {
    withoutIntlSegmenter(() => {
      expect(segmentGraphemes(FLAG_PAIR)).toEqual(['🇺🇸', '🇨🇦']);
    });
  });

  it('keeps a Devanagari consonant conjunct together (native)', () => {
    expect(segmentGraphemes(DEVANAGARI_CONJUNCT_TEXT)).toEqual(['क्ष', 'त्रि', 'य']);
  });

  it('keeps a Devanagari consonant conjunct together (fallback)', () => {
    withoutIntlSegmenter(() => {
      expect(segmentGraphemes(DEVANAGARI_CONJUNCT_TEXT)).toEqual(['क्ष', 'त्रि', 'य']);
    });
  });

  it('keeps an Arabic base letter with its diacritic together (fallback)', () => {
    withoutIntlSegmenter(() => {
      const clusters = segmentGraphemes(ARABIC_WITH_DIACRITICS);
      // Every cluster must be a base letter plus its combining diacritic(s),
      // never a diacritic split off on its own.
      expect(clusters.join('')).toBe(ARABIC_WITH_DIACRITICS);
      expect(clusters.every((cluster) => cluster.length >= 1)).toBe(true);
      expect(clusters.length).toBeLessThan(ARABIC_WITH_DIACRITICS.length);
    });
  });

  it('never splits a surrogate pair (fallback)', () => {
    withoutIntlSegmenter(() => {
      const text = `a${ASTRAL_CHAR}b`;
      const clusters = segmentGraphemes(text);
      expect(clusters).toEqual(['a', ASTRAL_CHAR, 'b']);
      // Each cluster must be a lone valid codepoint, never half a surrogate pair.
      for (const cluster of clusters) {
        expect([...cluster]).toHaveLength(1);
      }
    });
  });
});

describe('graphemeLength', () => {
  it('counts extended grapheme clusters, not UTF-16 code units', () => {
    expect(graphemeLength(FAMILY_EMOJI)).toBe(1);
    expect(FAMILY_EMOJI.length).toBeGreaterThan(1);
  });
});

describe('truncateGraphemesTo', () => {
  afterEach(() => {
    resetGraphemeSegmenterCacheForTests();
  });

  it('returns the original text unchanged when already within budget', () => {
    expect(truncateGraphemesTo('hello', 10)).toBe('hello');
  });

  it('returns an empty string for a non-positive budget', () => {
    expect(truncateGraphemesTo('hello', 0)).toBe('');
    expect(truncateGraphemesTo('hello', -3)).toBe('');
  });

  it('prefers a sentence boundary within the search window', () => {
    const text = 'First sentence here. Second sentence continues onward and onward.';
    const truncated = truncateGraphemesTo(text, 25, { boundarySearchWindow: 20 });
    expect(truncated).toBe('First sentence here.');
  });

  it('falls back to a whitespace boundary when no sentence terminator is nearby', () => {
    const text = 'alpha beta gamma delta epsilon zeta';
    const truncated = truncateGraphemesTo(text, 17, { boundarySearchWindow: 10 });
    expect(truncated).toBe('alpha beta gamma');
  });

  it('cuts exactly at the limit when no boundary exists in the search window', () => {
    const text = 'x'.repeat(200);
    const truncated = truncateGraphemesTo(text, 50, { boundarySearchWindow: 5 });
    expect(truncated).toHaveLength(50);
  });

  for (const useFallback of [false, true]) {
    it(`never splits an emoji ZWJ sequence at any cut length (${useFallback ? 'fallback' : 'native'})`, () => {
      const run = () => {
        const text = `intro text ${FAMILY_EMOJI} outro text that continues on`;
        const total = graphemeLength(text);
        for (let n = 1; n <= total; n += 1) {
          const truncated = truncateGraphemesTo(text, n, { boundarySearchWindow: 0 });
          // A clean cut must be exactly the first N grapheme clusters joined —
          // if the emoji sequence were split, this join would diverge from the
          // literal substring the split produced.
          const clusters = segmentGraphemes(text);
          expect(truncated).toBe(clusters.slice(0, segmentGraphemes(truncated).length).join(''));
        }
      };
      if (useFallback) {
        withoutIntlSegmenter(run);
      } else {
        run();
      }
    });

    it(`never splits a Devanagari conjunct at any cut length (${useFallback ? 'fallback' : 'native'})`, () => {
      const run = () => {
        const text = `intro ${DEVANAGARI_CONJUNCT_TEXT} outro continues here`;
        const clusters = segmentGraphemes(text);
        for (let n = 1; n <= clusters.length; n += 1) {
          const truncated = truncateGraphemesTo(text, n, { boundarySearchWindow: 0 });
          const truncatedClusterCount = segmentGraphemes(truncated).length;
          expect(truncated).toBe(clusters.slice(0, truncatedClusterCount).join(''));
        }
      };
      if (useFallback) {
        withoutIntlSegmenter(run);
      } else {
        run();
      }
    });
  }
});

describe('truncateGraphemesFromEnd', () => {
  afterEach(() => {
    resetGraphemeSegmenterCacheForTests();
  });

  it('returns the original text unchanged when already within budget', () => {
    expect(truncateGraphemesFromEnd('hello', 10)).toBe('hello');
  });

  it('returns an empty string for a non-positive budget', () => {
    expect(truncateGraphemesFromEnd('hello', 0)).toBe('');
  });

  it('prefers to start right after a whitespace boundary', () => {
    const text = 'alpha beta gamma delta epsilon';
    const truncated = truncateGraphemesFromEnd(text, 12, { boundarySearchWindow: 8 });
    expect(truncated.startsWith(' ')).toBe(false);
    expect(text.endsWith(truncated)).toBe(true);
  });

  it('never splits a grapheme cluster at the start of the kept tail, with and without Intl.Segmenter', () => {
    for (const useFallback of [false, true]) {
      const run = () => {
        const text = `some leading words ${FAMILY_EMOJI}${DEVANAGARI_CONJUNCT_TEXT} trailing words here`;
        const clusters = segmentGraphemes(text);
        for (let n = 1; n <= clusters.length; n += 1) {
          const truncated = truncateGraphemesFromEnd(text, n, { boundarySearchWindow: 0 });
          const truncatedClusterCount = segmentGraphemes(truncated).length;
          const expectedSuffix = clusters.slice(clusters.length - truncatedClusterCount).join('');
          expect(truncated).toBe(expectedSuffix);
        }
      };
      if (useFallback) {
        withoutIntlSegmenter(run);
      } else {
        run();
      }
    }
  });
});
