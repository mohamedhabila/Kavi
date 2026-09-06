import { normalizeBrowserToolResult } from '../../../../src/engine/tools/resultNormalization/browserResult';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
  startsOnGraphemeBoundary,
} from '../../../helpers/graphemeTestFixtures';

describe('normalizeBrowserToolResult(browser_snapshot) — snapshot excerpt grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} at the head/tail excerpt seams (8,000-char budget)`, () => {
      const snapshot = `${'H'.repeat(2000)}${'M'.repeat(10000)}${cluster}${'T'.repeat(2000)}`;
      const raw = JSON.stringify({ targetId: 'target-1', snapshot, truncated: true });

      const result = normalizeBrowserToolResult('browser_snapshot', raw);
      const parsed = JSON.parse(result);
      const parsedSnapshot = String(parsed.snapshot ?? '');
      expectGraphemeSafe(parsedSnapshot);
      // parsedSnapshot is buildHeadTailExcerpt(snapshot, MAX_BROWSER_SNAPSHOT_CHARS).
      const [head, tail] = parsedSnapshot.split(/\n\.\.\. \[truncated \d+ chars\] \.\.\.\n/);
      expect(endsOnGraphemeBoundary(snapshot, head ?? '')).toBe(true);
      if (tail !== undefined) {
        expect(startsOnGraphemeBoundary(snapshot, tail)).toBe(true);
      }
    });
  }
});

describe('normalizeBrowserToolResult(browser_console) — message text grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 240-char console message budget`, () => {
      const text = buildBoundaryStraddlingText(240, cluster, 50);
      const raw = JSON.stringify({
        targetId: 'target-1',
        messages: [{ type: 'log', text }],
      });

      const result = normalizeBrowserToolResult('browser_console', raw);
      const parsed = JSON.parse(result);
      const messageText = String(parsed.messages[0].text ?? '');
      expectGraphemeSafe(messageText);
      // messageText is transformers' truncateText(text, 240), which appends a
      // dynamic-length `... (N chars omitted)` suffix.
      const cutText = messageText.replace(/\.\.\. \(\d+ chars omitted\)$/, '');
      expect(endsOnGraphemeBoundary(text, cutText)).toBe(true);
    });
  }
});
