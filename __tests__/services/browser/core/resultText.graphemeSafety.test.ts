import { truncateSearchText } from '../../../../src/services/browser/core/resultText';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../../helpers/graphemeTestFixtures';

describe('truncateSearchText — grapheme safety', () => {
  it('returns short text unchanged', () => {
    expect(truncateSearchText('short result')).toBe('short result');
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the default 320-char budget`, () => {
      const value = buildBoundaryStraddlingText(320, cluster, 100);
      const result = truncateSearchText(value);

      expect(result.endsWith('...')).toBe(true);
      expectGraphemeSafe(result);
      expect(endsOnGraphemeBoundary(value, result.slice(0, -'...'.length))).toBe(true);
    });
  }
});
