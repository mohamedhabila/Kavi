import { normalizeBrowserToolResult } from '../../../../src/engine/tools/resultNormalization/browserResult';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../../helpers/graphemeTestFixtures';

describe('normalizeBrowserToolResult(browser_snapshot) — snapshot excerpt grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} at the head/tail excerpt seams (8,000-char budget)`, () => {
      const snapshot = `${'H'.repeat(2000)}${'M'.repeat(10000)}${cluster}${'T'.repeat(2000)}`;
      const raw = JSON.stringify({ targetId: 'target-1', snapshot, truncated: true });

      const result = normalizeBrowserToolResult('browser_snapshot', raw);
      const parsed = JSON.parse(result);
      expectGraphemeSafe(String(parsed.snapshot ?? ''));
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
      expectGraphemeSafe(String(parsed.messages[0].text ?? ''));
    });
  }
});
