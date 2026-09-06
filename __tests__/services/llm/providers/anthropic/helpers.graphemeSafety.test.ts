import { simplifyAnthropicToolDescription } from '../../../../../src/services/llm/providers/anthropic/helpers';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../../../helpers/graphemeTestFixtures';

describe('simplifyAnthropicToolDescription — grapheme safety', () => {
  it('returns short descriptions unchanged', () => {
    expect(simplifyAnthropicToolDescription('Reads a file.')).toBe('Reads a file.');
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 2000-char provider payload cap`, () => {
      const description = buildBoundaryStraddlingText(2000, cluster, 200);
      const result = simplifyAnthropicToolDescription(description);

      expect(result.length).toBeLessThanOrEqual(2000);
      expect(result.endsWith('...')).toBe(true);
      expectGraphemeSafe(result);
    });
  }
});
