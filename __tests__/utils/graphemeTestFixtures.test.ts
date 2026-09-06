// ---------------------------------------------------------------------------
// Self-test — graphemeTestFixtures
// ---------------------------------------------------------------------------
// Proves the fixtures in this directory actually discriminate: for every
// fixture cluster and both straddling-text builders, (a) the naive UTF-16
// code-unit slice the builders are named for FAILS the new
// `endsOnGraphemeBoundary` / `startsOnGraphemeBoundary` oracle, and (b) the
// real grapheme-safe truncation helpers in `src/utils/graphemes.ts` PASS it.
// Without this file, a change that weakened a builder's cut placement (or
// broke the oracle itself) could silently stop catching anything.

import {
  segmentGraphemes,
  truncateGraphemesFromEnd,
  truncateGraphemesTo,
  truncateToUtf16BudgetGraphemeSafe,
} from '../../src/utils/graphemes';
import {
  buildBoundaryStraddlingText,
  buildTailBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  GRAPHEME_CLUSTER_FIXTURES,
  startsOnGraphemeBoundary,
} from '../helpers/graphemeTestFixtures';

/** UTF-16 code-unit budget used to build every straddling text below — large
 * enough that the ASCII filler on both sides is never itself exhausted. */
const CODE_UNIT_BOUNDARY = 60;
const FILLER_LENGTH = 40;

/** Index, within `text`'s grapheme clusters, of the single cluster equal to
 * `cluster` — i.e. where the fixture's probe sits among the ASCII filler. A
 * grapheme-count truncation can only ever keep or drop this cluster whole
 * (it has no way to land "inside" it), so this index is what picks the two
 * maxLength values — one on each side of the cluster — worth exercising. */
function findFixtureClusterIndex(text: string, cluster: string): number {
  const clusterIndex = segmentGraphemes(text).indexOf(cluster);
  if (clusterIndex === -1) {
    throw new Error('fixture cluster not found as its own grapheme cluster in the built text');
  }
  return clusterIndex;
}

describe('graphemeTestFixtures self-test', () => {
  describe.each(GRAPHEME_CLUSTER_FIXTURES)('$name', ({ cluster }) => {
    describe('buildBoundaryStraddlingText (keep-first / head truncation)', () => {
      const text = buildBoundaryStraddlingText(CODE_UNIT_BOUNDARY, cluster, FILLER_LENGTH);

      it('the naive code-unit slice fails endsOnGraphemeBoundary', () => {
        const naiveOutput = text.slice(0, CODE_UNIT_BOUNDARY);
        expect(endsOnGraphemeBoundary(text, naiveOutput)).toBe(false);
      });

      it('truncateToUtf16BudgetGraphemeSafe passes endsOnGraphemeBoundary at the same budget', () => {
        const output = truncateToUtf16BudgetGraphemeSafe(text, CODE_UNIT_BOUNDARY);
        expect(endsOnGraphemeBoundary(text, output)).toBe(true);
      });

      it('truncateGraphemesTo passes endsOnGraphemeBoundary on both sides of the probe cluster', () => {
        const clusterIndex = findFixtureClusterIndex(text, cluster);

        const excludingProbe = truncateGraphemesTo(text, clusterIndex);
        expect(endsOnGraphemeBoundary(text, excludingProbe)).toBe(true);

        const includingProbe = truncateGraphemesTo(text, clusterIndex + 1);
        expect(endsOnGraphemeBoundary(text, includingProbe)).toBe(true);
      });
    });

    describe('buildTailBoundaryStraddlingText (keep-last / tail truncation)', () => {
      const text = buildTailBoundaryStraddlingText(CODE_UNIT_BOUNDARY, cluster, FILLER_LENGTH);

      it('the naive code-unit slice fails startsOnGraphemeBoundary', () => {
        const naiveOutput = text.slice(-CODE_UNIT_BOUNDARY);
        expect(startsOnGraphemeBoundary(text, naiveOutput)).toBe(false);
      });

      it('truncateGraphemesFromEnd passes startsOnGraphemeBoundary on both sides of the probe cluster', () => {
        const clusters = segmentGraphemes(text);
        const clusterIndex = findFixtureClusterIndex(text, cluster);
        const graphemesAfterProbeStart = clusters.length - clusterIndex;
        const graphemesAfterProbeEnd = clusters.length - clusterIndex - 1;

        const excludingProbe = truncateGraphemesFromEnd(text, graphemesAfterProbeEnd);
        expect(startsOnGraphemeBoundary(text, excludingProbe)).toBe(true);

        const includingProbe = truncateGraphemesFromEnd(text, graphemesAfterProbeStart);
        expect(startsOnGraphemeBoundary(text, includingProbe)).toBe(true);
      });
    });
  });

  describe('endsOnGraphemeBoundary / startsOnGraphemeBoundary', () => {
    it('accepts an output identical to the input (zero truncation)', () => {
      const text = `intro ${GRAPHEME_CLUSTER_FIXTURES[0].cluster} outro`;
      expect(endsOnGraphemeBoundary(text, text)).toBe(true);
      expect(startsOnGraphemeBoundary(text, text)).toBe(true);
    });

    it('accepts an empty output', () => {
      const text = `intro ${GRAPHEME_CLUSTER_FIXTURES[0].cluster} outro`;
      expect(endsOnGraphemeBoundary(text, '')).toBe(true);
      expect(startsOnGraphemeBoundary(text, '')).toBe(true);
    });

    it('rejects an output that is not a prefix/suffix of the input at all', () => {
      const text = 'hello world';
      expect(endsOnGraphemeBoundary(text, 'goodbye')).toBe(false);
      expect(startsOnGraphemeBoundary(text, 'goodbye')).toBe(false);
    });
  });
});
