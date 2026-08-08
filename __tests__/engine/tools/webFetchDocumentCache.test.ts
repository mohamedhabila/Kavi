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

describe('a definitive answer is not re-asked with another User-Agent', () => {
  // Traced on-device over a twelve-source research run: 19 primary attempts drew 18
  // fallback retries, nearly all a second request for a 404 the site had already
  // answered — doubling the cost of every dead URL.
  const statusResponse = (status: number) => ({
    ok: false,
    status,
    statusText: 'x',
    url: URL,
    headers: { get: () => 'text/html' },
    text: async () => 'nope',
    body: null,
  });

  const attempts = async (status: number) => {
    fetchMock.mockImplementation(async () => statusResponse(status));
    await expect(directFetch({ url: URL, extractMode: 'markdown', maxChars: 200 })).rejects.toThrow();
    return fetchMock.mock.calls.length;
  };

  it('asks once for a 404', async () => {
    expect(await attempts(404)).toBe(1);
  });

  it('asks once for a 410', async () => {
    expect(await attempts(410)).toBe(1);
  });

  it('still retries a bot wall, where client identity can matter', async () => {
    expect(await attempts(403)).toBe(2);
  });

  it('still retries a rate limit', async () => {
    expect(await attempts(429)).toBe(2);
  });

  it('still retries a server error, which is a failure not a refusal', async () => {
    expect(await attempts(500)).toBe(2);
  });

  it('still retries a transport failure, which is not an answer at all', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('fetch failed: stream was reset: INTERNAL_ERROR');
    });
    await expect(directFetch({ url: URL, extractMode: 'markdown', maxChars: 200 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
