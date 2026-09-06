import { executePdfRead } from '../../../src/engine/tools/builtin-utility';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('executePdfRead (non-PDF URL) — extracted content grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 50000-char content budget`, async () => {
      const text = buildBoundaryStraddlingText(50000, cluster, 200);
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'text/plain' },
        text: async () => text,
      }) as any;

      const outcome = await executePdfRead({ path: 'https://example.com/doc.txt' });
      const parsed = JSON.parse((outcome as any).content);
      expectGraphemeSafe(String(parsed.content ?? ''));
      expect(endsOnGraphemeBoundary(text, String(parsed.content ?? ''))).toBe(true);
    });
  }
});
