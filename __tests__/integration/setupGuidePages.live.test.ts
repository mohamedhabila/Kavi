// Live check that every vendor page a setup guide reads still extracts through Kavi's own
// web_fetch with no Firecrawl key, a new person's situation. Vendors move and redesign
// pages; run with `npm run test:live:setup-pages` to catch a page that stopped reading.

import { executeWebFetch } from '../../src/engine/tools/web-fetch';
import { SETUP_TOPICS, type SetupPage } from '../../src/services/setup/setupGuideTypes';
import { setupGuideFor } from '../../src/services/setup/setupGuides';

const live = process.env.RUN_LIVE_SETUP_PAGES === '1';
/** Below this, a page rendered in the browser and came back as a shell. */
const MIN_READABLE_CHARS = 1_000;

function everyGuidePage(): SetupPage[] {
  const pages = new Map<string, SetupPage>();
  for (const topic of SETUP_TOPICS) {
    const base = setupGuideFor(topic, undefined);
    for (const option of [undefined, ...(base.options ?? []).map((candidate) => candidate.id)]) {
      for (const page of setupGuideFor(topic, option).pages) pages.set(page.url, page);
    }
  }
  return [...pages.values()];
}

(live ? describe : describe.skip)('setup guide pages, live', () => {
  it.each(everyGuidePage().map((page) => [page.url, page] as const))(
    'reads %s',
    async (_url, page) => {
      const outcome = await executeWebFetch({ urls: [page.url], maxChars: page.maxChars ?? 5_000 });
      const entry = (JSON.parse(outcome.content) as { fetches: Array<Record<string, unknown>> })
        .fetches[0]!;

      expect(entry.error).toBeUndefined();
      expect(String(entry.content ?? '').length).toBeGreaterThanOrEqual(MIN_READABLE_CHARS);
    },
    30_000,
  );
});
