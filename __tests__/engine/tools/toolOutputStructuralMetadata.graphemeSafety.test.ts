import { extractToolOutputStructuralMetadata } from '../../../src/engine/tools/toolOutputStructuralMetadata';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('extractToolOutputStructuralMetadata — output preview grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 600-char output preview budget`, () => {
      const output = buildBoundaryStraddlingText(600, cluster, 200);
      const metadata = extractToolOutputStructuralMetadata({
        toolName: 'sessions_spawn',
        result: JSON.stringify({ sessionId: 's1', status: 'completed', output }),
      });

      const preview = String(metadata?.sessions[0]?.outputPreview ?? '');
      expect(preview.length).toBeGreaterThan(0);
      expectGraphemeSafe(preview);
      // preview is truncateGraphemesWithSuffix(output.trim(), 600, '…') — strip
      // the single-character ellipsis suffix to recover the underlying cut.
      expect(endsOnGraphemeBoundary(output, preview.slice(0, -'…'.length))).toBe(true);
    });
  }
});
