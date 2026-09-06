import { mergeAssistantContinuationText } from '../../src/engine/orchestratorText';
import {
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../helpers/graphemeTestFixtures';

describe('mergeAssistantContinuationText — overlap-seam grapheme safety', () => {
  it('merges non-overlapping plain text by concatenation', () => {
    expect(mergeAssistantContinuationText('Hello ', 'world')).toBe('Hello world');
  });

  it('merges overlapping plain text without duplicating the shared suffix/prefix', () => {
    expect(mergeAssistantContinuationText('The quick brown fox', 'brown fox jumps')).toBe(
      'The quick brown fox jumps',
    );
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} at the overlap seam`, () => {
      const shared = `shared context ${cluster} tail text that is long enough to overlap`;
      const existing = `preamble before the ${shared}`;
      const incoming = `${shared} continues after the overlap`;

      const merged = mergeAssistantContinuationText(existing, incoming);
      expectGraphemeSafe(merged);
      expect(merged).toContain(cluster);
    });
  }
});
