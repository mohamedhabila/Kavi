import { executeToolInner } from '../../../src/engine/tools/toolDispatchRouter';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
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
      const content = (outcome as any).content as string;
      expectGraphemeSafe(content);
      // content is `Error: tool "<name>" received malformed JSON arguments that
      // could not be parsed. Raw input: <cut>…\nPlease retry ...` where <cut> is
      // truncateGraphemesWithSuffix(malformed, 300, '…').
      const rawInputMarker = 'Raw input: ';
      const suffixMarker = '\nPlease retry the tool call with valid JSON arguments.';
      const afterMarker = content.slice(content.indexOf(rawInputMarker) + rawInputMarker.length);
      const preview = afterMarker.slice(0, afterMarker.length - suffixMarker.length);
      const cutText = preview.slice(0, -'…'.length);
      expect(endsOnGraphemeBoundary(malformed, cutText)).toBe(true);
    });
  }
});
