import { clearWebFetchDocumentCache, directFetch } from '../../../src/engine/tools/webFetchTransports';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

const fetchMock = jest.fn();
(globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) =>
    (globalThis as unknown as { fetch: (...a: unknown[]) => unknown }).fetch(...args),
}));

beforeEach(() => {
  clearWebFetchDocumentCache();
  fetchMock.mockReset();
});

describe('directFetch — HTTP error body detail grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 160-char error detail budget`, async () => {
      const body = buildBoundaryStraddlingText(160, cluster, 100);
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        url: 'https://example.com/unavailable',
        headers: { get: () => 'text/plain' },
        text: async () => body,
        body: null,
      });

      const error = await directFetch({
        url: 'https://example.com/unavailable',
        extractMode: 'text',
        maxChars: 1000,
      }).catch((caught: unknown) => caught as Error);

      expect(error).toBeInstanceOf(Error);
      expectGraphemeSafe(error.message);
      // message is `HTTP 503 Service Unavailable: <cut>...` where <cut> is
      // truncateGraphemesTo(body, 157) (160-char budget minus the 3-char suffix).
      const prefix = 'HTTP 503 Service Unavailable: ';
      const detail = error.message.slice(prefix.length);
      const cutText = detail.slice(0, -'...'.length);
      expect(endsOnGraphemeBoundary(body, cutText)).toBe(true);
    });
  }
});
