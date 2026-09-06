import { simplifyGeminiToolDescription } from '../../../../../src/services/llm/providers/gemini/schema';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../../../helpers/graphemeTestFixtures';

describe('simplifyGeminiToolDescription — grapheme safety', () => {
  it('returns short descriptions unchanged', () => {
    expect(simplifyGeminiToolDescription('Reads a file.')).toBe('Reads a file.');
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 2000-char provider payload cap`, () => {
      const description = buildBoundaryStraddlingText(2000, cluster, 200);
      const result = simplifyGeminiToolDescription(description);

      expect(result.length).toBeLessThanOrEqual(2000);
      expect(result.endsWith('...')).toBe(true);
      expectGraphemeSafe(result);
      expect(endsOnGraphemeBoundary(description, result.slice(0, -'...'.length))).toBe(true);
    });
  }
});
