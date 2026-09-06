import { createKnowledgeSkill } from '../../../../src/services/integrations/knowledge/skill';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../../helpers/graphemeTestFixtures';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('knowledge skill (wikipedia_summary) — extract grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 2000-char extract budget`, async () => {
      const extract = buildBoundaryStraddlingText(2000, cluster, 200);
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          title: 'Test Topic',
          extract,
          thumbnail: { source: 'https://example.com/thumb.png' },
          content_urls: { desktop: { page: 'https://example.com/page' } },
        }),
      }) as any;

      const skill = createKnowledgeSkill();
      const tool = skill.tools.find((entry) => entry.name === 'wikipedia_summary')!;
      const outcome = await tool.handler({ topic: 'Test Topic' }, {} as any);

      const parsed = JSON.parse((outcome as any).content);
      expectGraphemeSafe(String(parsed.extract ?? ''));
    });
  }
});
