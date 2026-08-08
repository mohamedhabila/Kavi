import { directFetch, clearWebFetchDocumentCache } from '../../../src/engine/tools/webFetchTransports';

// Measured on-device against en.wikipedia.org/wiki/Jupiter: 1,415,879 chars, ~9.8s to
// convert to markdown and ~10.8s to scan for links, against ~0.2s of network. The
// response cache was keyed on url + mode + maxChars + offset + find, so changing any
// window parameter missed and repeated that whole expensive half — including the paging
// flow the tool itself documents ("pass the nextOffset ... to continue reading").

const PAGE = `<html><head><title>Jupiter</title></head><body><main>
<p>${'Jupiter is the largest planet in the Solar System. '.repeat(40)}</p>
<a href="https://example.com/source">Source</a>
</main></body></html>`;

const fetchMock = jest.fn();
(globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) =>
    (globalThis as unknown as { fetch: (...a: unknown[]) => unknown }).fetch(...args),
}));

function htmlResponse() {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url: 'https://en.wikipedia.org/wiki/Jupiter',
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'text/html' : null) },
    text: async () => PAGE,
    body: null,
  };
}

beforeEach(() => {
  clearWebFetchDocumentCache();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => htmlResponse());
});

const URL = 'https://en.wikipedia.org/wiki/Jupiter';

describe('a second window over the same page reuses the extracted document', () => {
  it('does not go back to the network when only maxChars differs', async () => {
    await directFetch({ url: URL, extractMode: 'markdown', maxChars: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await directFetch({ url: URL, extractMode: 'markdown', maxChars: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not go back to the network when paging by offset', async () => {
    const first = await directFetch({ url: URL, extractMode: 'markdown', maxChars: 100 });
    expect(first.truncated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const next = await directFetch({
      url: URL,
      extractMode: 'markdown',
      maxChars: 100,
      offset: first.nextOffset ?? 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(next.content).not.toBe(first.content);
  });

  it('returns the same window content as an uncached fetch would', async () => {
    const cold = await directFetch({ url: URL, extractMode: 'markdown', maxChars: 300 });
    clearWebFetchDocumentCache();
    fetchMock.mockClear();
    const alsoCold = await directFetch({ url: URL, extractMode: 'markdown', maxChars: 300 });
    const warm = await directFetch({ url: URL, extractMode: 'markdown', maxChars: 300 });

    expect(alsoCold.content).toBe(cold.content);
    expect(warm.content).toBe(cold.content);
    expect(warm.title).toBe(cold.title);
  });

  it('keeps text and markdown modes separate', async () => {
    await directFetch({ url: URL, extractMode: 'markdown', maxChars: 300 });
    await directFetch({ url: URL, extractMode: 'text', maxChars: 300 });

    // A different extraction mode is a different document, so it must refetch.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches a different url', async () => {
    await directFetch({ url: URL, extractMode: 'markdown', maxChars: 300 });
    await directFetch({ url: `${URL}_(moon)`, extractMode: 'markdown', maxChars: 300 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
