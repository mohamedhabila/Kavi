import { executeToolInner } from '../../../src/engine/tools/toolDispatchRouter';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('executeToolInner — malformed-JSON preview grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 300-char raw-input preview budget`, async () => {
      // Deliberately malformed JSON (missing closing brace) so parseToolArgumentsJson
      // throws and the raw input is echoed back, truncated, in the error message.
      const filler = buildBoundaryStraddlingText(300, cluster, 100);
      const malformed = `{"note": "${filler}"`;

      const outcome = await executeToolInner('some_tool', malformed, 'conversation-1');
      expectGraphemeSafe((outcome as any).content as string);
    });
  }
});
