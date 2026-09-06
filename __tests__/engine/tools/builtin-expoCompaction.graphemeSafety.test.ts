import { truncateExpoText } from '../../../src/engine/tools/builtin-expoCompaction';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('truncateExpoText — grapheme safety', () => {
  it('returns text unchanged when within budget', () => {
    expect(truncateExpoText('short', 100)).toBe('short');
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the truncation budget`, () => {
      const boundary = 80;
      const text = buildBoundaryStraddlingText(boundary, cluster, 100);
      const result = truncateExpoText(text, boundary);

      expect(result.endsWith('...')).toBe(true);
      expectGraphemeSafe(result);
      expect(endsOnGraphemeBoundary(text, result.slice(0, -'...'.length))).toBe(true);
    });
  }
});
