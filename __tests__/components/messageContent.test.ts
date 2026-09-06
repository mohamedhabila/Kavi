import { buildContentRenderPlan } from '../../src/components/chat/messageContent';
import {
  GRAPHEME_CLUSTER_FIXTURES,
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
} from '../helpers/graphemeTestFixtures';

const MARKDOWN_CHAR_LIMIT = 140_000;

describe('buildContentRenderPlan — truncation grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the ${MARKDOWN_CHAR_LIMIT}-char markdown budget`, () => {
      const longContent = buildBoundaryStraddlingText(MARKDOWN_CHAR_LIMIT, cluster, 40);

      const plan = buildContentRenderPlan(longContent);

      expect(plan).not.toBeNull();
      expect(plan!.truncated).toBe(true);
      // The rendered text is the grapheme-safe cut plus an appended notice (which embeds
      // the original length), so it can be longer than the raw cut itself — but the cut
      // portion carried inside it must still be shorter than the untruncated content.
      expect(plan!.text).not.toBe(longContent);
      expect(plan!.text).toContain('truncated (');
      expectGraphemeSafe(plan!.text);
      // plan.text is `${cutText}\n\n… truncated (N chars, showing first M).` where
      // cutText is truncateGraphemesTo(longContent, MARKDOWN_CHAR_LIMIT).
      const marker = '\n\n… truncated (';
      const cutText = plan!.text.slice(0, plan!.text.indexOf(marker));
      expect(endsOnGraphemeBoundary(longContent, cutText)).toBe(true);
    });
  }

  it('leaves short content untouched', () => {
    const plan = buildContentRenderPlan('Hello world');
    expect(plan).toEqual({ text: 'Hello world', mode: 'markdown', truncated: false });
  });
});
