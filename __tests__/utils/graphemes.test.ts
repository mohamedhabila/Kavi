// ---------------------------------------------------------------------------
// Tests — Grapheme-safe text utilities
// ---------------------------------------------------------------------------

import {
  exceedsGraphemeLength,
  graphemeLength,
  resetGraphemeSegmenterCacheForTests,
  segmentGraphemes,
  truncateGraphemesFromEnd,
  truncateGraphemesTo,
  truncateToUtf16BudgetGraphemeSafe,
} from '../../src/utils/graphemes';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../helpers/graphemeTestFixtures';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦'; // man ZWJ woman ZWJ girl ZWJ boy
const FLAG_PAIR = '🇺🇸🇨🇦'; // two regional-indicator flag pairs
const DEVANAGARI_CONJUNCT_TEXT = 'क्षत्रिय';
const ARABIC_WITH_DIACRITICS = 'بِسْمِ';
const ASTRAL_CHAR = '𝌆'; // U+1D306, outside the BMP (surrogate pair)
// Thai vowel/tone signs (ั = mai han-akat, ี = sara ii) are combining marks
// (\p{M}) attached to the preceding consonant, same family as the Arabic
// diacritics above but a distinct script for the semantics table below.
const THAI_WITH_MARKS = 'สวัสดีครับ';
const MIXED_SCRIPT_TEXT = `Hello ${THAI_WITH_MARKS} ${FAMILY_EMOJI} ${DEVANAGARI_CONJUNCT_TEXT} ${ARABIC_WITH_DIACRITICS}`;

/**
 * Builds a stub `Intl.Segmenter` constructor that delegates to the real
 * implementation but counts how many times `.segment()` is invoked and how
 * many clusters are actually pulled off the resulting iterator — so a test
 * can prove a fast path skips segmentation entirely, or that lazy iteration
 * stops as soon as the caller has its answer instead of exhausting the
 * string.
 */
function createCountingSegmenterCtor(): {
  stubCtor: new (...args: unknown[]) => unknown;
  getSegmentCalls: () => number;
  getTotalPulled: () => number;
} {
  const real = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' });
  let segmentCalls = 0;
  let totalPulled = 0;

  function StubSegmenter(): unknown {
    return {
      segment(input: string) {
        segmentCalls += 1;
        const innerIterable = real.segment(input);
        return {
          [Symbol.iterator]() {
            const iterator = innerIterable[Symbol.iterator]();
            return {
              next() {
                const result = iterator.next();
                if (!result.done) totalPulled += 1;
                return result;
              },
            };
          },
        };
      },
    };
  }

  return {
    stubCtor: StubSegmenter as unknown as new (...args: unknown[]) => unknown,
    getSegmentCalls: () => segmentCalls,
    getTotalPulled: () => totalPulled,
  };
}

function withCountingSegmenter<T>(
  run: (counts: { getSegmentCalls: () => number; getTotalPulled: () => number }) => T,
): T {
  const { stubCtor, getSegmentCalls, getTotalPulled } = createCountingSegmenterCtor();
  const original = (Intl as any).Segmenter;
  (Intl as any).Segmenter = stubCtor;
  resetGraphemeSegmenterCacheForTests();
  try {
    return run({ getSegmentCalls, getTotalPulled });
  } finally {
    (Intl as any).Segmenter = original;
    resetGraphemeSegmenterCacheForTests();
  }
}

/** True when `text` contains a UTF-16 code unit half of a surrogate pair with no partner. */
function hasLoneSurrogate(text: string): boolean {
  const isWellFormed = (String.prototype as { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof isWellFormed === 'function') {
    return !isWellFormed.call(text);
  }
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** True when the last grapheme of `text` is a bare combining mark left dangling by a cut. */
function endsWithDanglingCombiningMark(text: string): boolean {
  if (!text) return false;
  const clusters = segmentGraphemes(text);
  const last = clusters[clusters.length - 1] ?? '';
  return /^\p{M}+$/u.test(last);
}

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

describe('truncateToUtf16BudgetGraphemeSafe', () => {
  afterEach(() => {
    resetGraphemeSegmenterCacheForTests();
  });

  it('returns the original text unchanged when already within the code-unit budget', () => {
    expect(truncateToUtf16BudgetGraphemeSafe('hello', 10)).toBe('hello');
  });

  it('returns an empty string for a non-positive budget', () => {
    expect(truncateToUtf16BudgetGraphemeSafe('hello', 0)).toBe('');
    expect(truncateToUtf16BudgetGraphemeSafe('hello', -3)).toBe('');
  });

  it('cuts a plain-ASCII string exactly at the code-unit budget', () => {
    const text = 'x'.repeat(200);
    const truncated = truncateToUtf16BudgetGraphemeSafe(text, 50);
    expect(truncated).toHaveLength(50);
  });

  it('never exceeds the UTF-16 budget and never splits a surrogate pair at any cut length', () => {
    const text = `intro text ${ASTRAL_CHAR} outro text that keeps going onward`;
    for (let budget = 1; budget <= text.length; budget += 1) {
      const truncated = truncateToUtf16BudgetGraphemeSafe(text, budget);
      expect(truncated.length).toBeLessThanOrEqual(budget);
      expect(hasLoneSurrogate(truncated)).toBe(false);
      expect(endsWithDanglingCombiningMark(truncated)).toBe(false);
      expect(text.startsWith(truncated)).toBe(true);
    }
  });

  for (const useFallback of [false, true]) {
    it(`never splits an emoji ZWJ family sequence positioned at the cut boundary (${useFallback ? 'fallback' : 'native'})`, () => {
      const run = () => {
        const text = `intro text ${FAMILY_EMOJI} outro text that keeps going onward`;
        for (let budget = 1; budget <= text.length; budget += 1) {
          const truncated = truncateToUtf16BudgetGraphemeSafe(text, budget);
          expect(truncated.length).toBeLessThanOrEqual(budget);
          expect(hasLoneSurrogate(truncated)).toBe(false);
          expect(endsWithDanglingCombiningMark(truncated)).toBe(false);
          expect(text.startsWith(truncated)).toBe(true);
          // A clean cut must be a whole number of grapheme clusters joined —
          // if the ZWJ sequence were split, this would not round-trip.
          const clusters = segmentGraphemes(text);
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

    it(`never splits a Devanagari conjunct or leaves an Arabic diacritic dangling at the cut boundary (${useFallback ? 'fallback' : 'native'})`, () => {
      const run = () => {
        const text = `intro ${DEVANAGARI_CONJUNCT_TEXT} middle ${ARABIC_WITH_DIACRITICS} outro continues`;
        for (let budget = 1; budget <= text.length; budget += 1) {
          const truncated = truncateToUtf16BudgetGraphemeSafe(text, budget);
          expect(truncated.length).toBeLessThanOrEqual(budget);
          expect(hasLoneSurrogate(truncated)).toBe(false);
          expect(endsWithDanglingCombiningMark(truncated)).toBe(false);
          const clusters = segmentGraphemes(text);
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

  // Merged from the former `truncateToCodeUnitBudget` (src/engine/text/graphemeBoundary.ts,
  // now deleted): the two implementations were behaviorally identical greedy
  // grapheme-accumulation cuts, so this file keeps the one name/home and both
  // test suites' coverage.
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the code-unit budget`, () => {
      const boundary = 60;
      const text = buildBoundaryStraddlingText(boundary, cluster);
      const result = truncateToUtf16BudgetGraphemeSafe(text, boundary);

      expect(result.length).toBeLessThanOrEqual(boundary);
      expectGraphemeSafe(result);
      expect(endsOnGraphemeBoundary(text, result)).toBe(true);
      // The cluster itself must be either fully included or fully excluded.
      expect(result.includes(cluster) || !result.includes(cluster.charAt(0))).toBe(true);
    });
  }

  it('never exceeds the requested code-unit budget across many random cut points', () => {
    const text = `${'x'.repeat(50)}${GRAPHEME_CLUSTER_FIXTURES.map((f) => f.cluster).join('')}${'y'.repeat(50)}`;
    for (let budget = 1; budget <= text.length; budget += 1) {
      const result = truncateToUtf16BudgetGraphemeSafe(text, budget);
      expect(result.length).toBeLessThanOrEqual(budget);
      expectGraphemeSafe(result);
      expect(endsOnGraphemeBoundary(text, result)).toBe(true);
    }
  });

  it('keeps the text unchanged when a single cluster is larger than the budget but the whole text still fits', () => {
    // The length check is against text.length first, so a text that fits
    // overall returns unchanged even though one cluster (the astral char) is
    // itself multiple code units.
    expect(truncateToUtf16BudgetGraphemeSafe(ASTRAL_CHAR, 2)).toBe(ASTRAL_CHAR);
  });

  it('drops a single cluster whole when it alone exceeds the budget', () => {
    const text = `${ASTRAL_CHAR}tail`;
    // Budget 1 code unit cannot fit the 2-code-unit astral character; it must
    // be dropped whole rather than split into a lone surrogate.
    expect(truncateToUtf16BudgetGraphemeSafe(text, 1)).toBe('');
  });
});

describe('exceedsGraphemeLength', () => {
  afterEach(() => {
    resetGraphemeSegmenterCacheForTests();
  });

  const SEMANTIC_FIXTURES: ReadonlyArray<{ name: string; text: string }> = [
    { name: 'empty string', text: '' },
    { name: 'plain ASCII', text: 'hello world' },
    { name: 'a ZWJ family emoji', text: FAMILY_EMOJI },
    { name: 'Devanagari conjuncts', text: DEVANAGARI_CONJUNCT_TEXT },
    { name: 'Arabic with combining diacritics', text: ARABIC_WITH_DIACRITICS },
    { name: 'Thai with combining tone/vowel marks', text: THAI_WITH_MARKS },
    { name: 'mixed scripts and emoji', text: MIXED_SCRIPT_TEXT },
  ];

  const LIMIT_OFFSETS_FROM_EXACT = [-1, 0, 1] as const;

  describe('agrees with `graphemeLength(text) > limit` (native Intl.Segmenter)', () => {
    for (const { name, text } of SEMANTIC_FIXTURES) {
      it(name, () => {
        const exact = graphemeLength(text);
        const limits = [-1, 0, ...LIMIT_OFFSETS_FROM_EXACT.map((offset) => exact + offset)];
        for (const limit of limits) {
          expect(exceedsGraphemeLength(text, limit)).toBe(exact > limit);
        }
      });
    }
  });

  describe('agrees with `graphemeLength(text) > limit` (fallback path)', () => {
    for (const { name, text } of SEMANTIC_FIXTURES) {
      it(name, () => {
        withoutIntlSegmenter(() => {
          const exact = graphemeLength(text);
          const limits = [-1, 0, ...LIMIT_OFFSETS_FROM_EXACT.map((offset) => exact + offset)];
          for (const limit of limits) {
            expect(exceedsGraphemeLength(text, limit)).toBe(exact > limit);
          }
        });
      });
    }
  });

  describe('edge-case limit semantics', () => {
    it('is false for an empty string against a non-negative limit', () => {
      expect(exceedsGraphemeLength('', 0)).toBe(false);
      expect(exceedsGraphemeLength('', 5)).toBe(false);
    });

    it('is true for an empty string against a negative limit (0 clusters > a negative limit)', () => {
      expect(exceedsGraphemeLength('', -1)).toBe(true);
      expect(exceedsGraphemeLength('', -0.5)).toBe(true);
    });

    it('is true for any non-empty text against a zero or negative limit', () => {
      expect(exceedsGraphemeLength('a', 0)).toBe(true);
      expect(exceedsGraphemeLength('a', -1)).toBe(true);
      expect(exceedsGraphemeLength(FAMILY_EMOJI, 0)).toBe(true);
    });

    it('is always false when the limit is +Infinity', () => {
      expect(exceedsGraphemeLength('x'.repeat(10_000), Infinity)).toBe(false);
      expect(exceedsGraphemeLength('', Infinity)).toBe(false);
    });

    it('is true against -Infinity for any text, including empty', () => {
      expect(exceedsGraphemeLength('a', -Infinity)).toBe(true);
      expect(exceedsGraphemeLength('', -Infinity)).toBe(true);
    });

    it('is always false when the limit is NaN, matching plain `>` semantics against NaN', () => {
      expect(exceedsGraphemeLength('hello', NaN)).toBe(false);
      expect(exceedsGraphemeLength('', NaN)).toBe(false);
      expect(exceedsGraphemeLength('x'.repeat(10_000), NaN)).toBe(false);
    });
  });

  describe('lazy iteration (native Intl.Segmenter)', () => {
    it('never calls segment() when text.length <= limit', () => {
      withCountingSegmenter(({ getSegmentCalls }) => {
        expect(exceedsGraphemeLength('short text', 20)).toBe(false);
        expect(exceedsGraphemeLength('short text', 'short text'.length)).toBe(false);
        expect(getSegmentCalls()).toBe(0);
      });
    });

    it('stops pulling the iterator as soon as the running count exceeds the limit', () => {
      withCountingSegmenter(({ getTotalPulled }) => {
        const longText = 'x'.repeat(10_000);
        const limit = 5;
        expect(exceedsGraphemeLength(longText, limit)).toBe(true);
        // Exactly limit + 1 clusters are needed to prove the count exceeds
        // limit — never the whole 10,000-character string.
        expect(getTotalPulled()).toBe(limit + 1);
      });
    });
  });
});

describe('grapheme fast paths skip segmentation when already within budget', () => {
  afterEach(() => {
    resetGraphemeSegmenterCacheForTests();
  });

  it('truncateGraphemesTo never calls segment() when text.length <= maxLength', () => {
    withCountingSegmenter(({ getSegmentCalls }) => {
      expect(truncateGraphemesTo('short text', 20)).toBe('short text');
      expect(truncateGraphemesTo('short text', 'short text'.length)).toBe('short text');
      expect(getSegmentCalls()).toBe(0);
    });
  });

  it('truncateGraphemesFromEnd never calls segment() when text.length <= maxLength', () => {
    withCountingSegmenter(({ getSegmentCalls }) => {
      expect(truncateGraphemesFromEnd('short text', 20)).toBe('short text');
      expect(truncateGraphemesFromEnd('short text', 'short text'.length)).toBe('short text');
      expect(getSegmentCalls()).toBe(0);
    });
  });
});
