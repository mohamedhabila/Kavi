import { compactResearchToolResultContent } from '../../../src/engine/graph/modelContextResearchCompaction';
import { expectGraphemeSafe, GRAPHEME_CLUSTER_FIXTURES } from '../../helpers/graphemeTestFixtures';

describe('compactResearchToolResultContent (web_fetch) — content excerpt grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} at the head/tail excerpt seams`, () => {
      const content = `${'H'.repeat(500)}${'M'.repeat(5000)}${cluster}${'T'.repeat(500)}`;
      const raw = JSON.stringify({
        fetches: [{ url: 'https://example.com', content }],
      });

      const result = compactResearchToolResultContent('web_fetch', raw);
      const parsed = JSON.parse(result);
      expectGraphemeSafe(String(parsed.fetches[0].contentExcerpt ?? ''));
    });
  }
});
