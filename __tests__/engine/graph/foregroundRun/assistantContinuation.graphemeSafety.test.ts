import { mergeAssistantContinuationText } from '../../../../src/engine/graph/foregroundRun/assistantContinuation';
import {
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../../helpers/graphemeTestFixtures';

describe('mergeAssistantContinuationText (foregroundRun) — overlap-seam grapheme safety', () => {
  it('merges non-overlapping plain text by concatenation', () => {
    expect(mergeAssistantContinuationText('Hello ', 'world')).toBe('Hello world');
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} at the overlap seam`, () => {
      // Long, structurally dissimilar text avoids the restart/overlapping-structured
      // replacement heuristics so the merge falls through to overlap detection.
      const shared = `some shared streaming context ${cluster} continues right here with more prose`;
      const existing = `${'Earlier unrelated paragraph content. '.repeat(3)}${shared}`;
      const incoming = `${shared}${' More new streamed prose follows after the seam.'.repeat(3)}`;

      const merged = mergeAssistantContinuationText(existing, incoming);
      expectGraphemeSafe(merged);
      expect(merged).toContain(cluster);
    });
  }
});
