// ---------------------------------------------------------------------------
// Tests — Web Fetch Tool
// ---------------------------------------------------------------------------

import { clearWebFetchCaches, executeWebFetch } from '../../src/engine/tools/web-fetch';

// Mock SecureStorage
const mockGetSecure = jest.fn();
jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
}));

// Mock SSRF check
jest.mock('../../src/services/security/ssrf', () => ({
  isAllowedUrl: (url: string) => !url.includes('internal') && !url.includes('169.254'),
}));

const mockFetch = jest.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch;
  mockGetSecure.mockResolvedValue(null);
  clearWebFetchCaches();
});

afterAll(() => {
  global.fetch = originalFetch;
});

function firstFetch(result: string): Record<string, any> {
  return JSON.parse(result).fetches[0];
}

describe('executeWebFetch', () => {
  it('returns error when URL is empty', async () => {
    const result = await executeWebFetch({ urls: [''] });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('At least one URL is required');
  });

  it('returns error when URL is blocked by SSRF', async () => {
    const parsed = firstFetch(await executeWebFetch({ urls: ['http://internal.local'] }));
    expect(parsed.error).toContain('security policy');
  });

  it('fetches HTML and converts to markdown', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      url: 'https://docs.example.com/final',
      headers: new Map([['content-type', 'text/html']]) as any,
      text: () =>
        Promise.resolve(
          '<html><head><title>Test Page</title></head><body><p>Hello world</p></body></html>',
        ),
    });

    const parsed = firstFetch(await executeWebFetch({ urls: ['https://example.com'] }));
    expect(parsed.url).toBe('https://docs.example.com/final');
    expect(parsed.resolvedUrl).toBe('https://docs.example.com/final');
    expect(parsed.content).toBeDefined();
    expect(parsed.charCount).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'follow',
      }),
    );
  });

  it('resolves relative links in fetched html against the final page url', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      url: 'https://developers.openai.com/api/docs/guides/migrate-to-responses',
      headers: new Map([['content-type', 'text/html']]) as any,
      text: () =>
        Promise.resolve(
          '<html><head><title>Guide</title></head><body><main><p>See <a href="/api/docs/api-reference/responses">Responses API</a>.</p></main></body></html>',
        ),
    });

    const parsed = firstFetch(
      await executeWebFetch({
        urls: ['https://developers.openai.com/api/docs/guides/migrate-to-responses'],
      }),
    );

    expect(parsed.content).toContain(
      '[Responses API](https://developers.openai.com/api/docs/api-reference/responses)',
    );
    expect(parsed.links).toEqual(
      expect.arrayContaining([
        {
          title: 'Responses API',
          url: 'https://developers.openai.com/api/docs/api-reference/responses',
        },
      ]),
    );
  });

  it('resolves Google grounding redirects before fetching page content', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 302,
        url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/openai',
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'location'
              ? 'https://platform.openai.com/docs/codex/overview'
              : null,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://platform.openai.com/docs/codex/overview',
        headers: {
          get: (h: string) => (h === 'content-type' ? 'text/html' : null),
        },
        text: () =>
          Promise.resolve(
            '<html><head><title>Codex</title></head><body><main><h1>Codex</h1><p>AGENTS.md support</p></main></body></html>',
          ),
      });

    const parsed = firstFetch(
      await executeWebFetch({
        urls: ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/openai'],
      }),
    );

    expect(parsed.requestedUrl).toBe(
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/openai',
    );
    expect(parsed.resolvedUrl).toBe('https://platform.openai.com/docs/codex/overview');
    expect(parsed.url).toBe('https://platform.openai.com/docs/codex/overview');
    expect(parsed.content).toContain('AGENTS.md support');
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://platform.openai.com/docs/codex/overview',
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'follow',
      }),
    );
  });

  it('fetches JSON content directly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      url: 'https://api.example.com/data',
      headers: {
        get: (h: string) => (h === 'content-type' ? 'application/json' : null),
      },
      text: () => Promise.resolve('{"key": "value"}'),
    });

    const parsed = firstFetch(await executeWebFetch({ urls: ['https://api.example.com/data'] }));
    expect(parsed.content).toContain('key');
  });

  it('fetches plain text content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      url: 'https://example.com/file.txt',
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/plain' : null),
      },
      text: () => Promise.resolve('Plain text content here'),
    });

    const parsed = firstFetch(await executeWebFetch({ urls: ['https://example.com/file.txt'] }));
    expect(parsed.content).toBe('Plain text content here');
  });

  it('fetches CSV content as plain text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      url: 'https://example.com/data.csv',
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/csv' : null),
      },
      text: () => Promise.resolve('a,b,c\n1,2,3'),
    });

    const parsed = firstFetch(await executeWebFetch({ urls: ['https://example.com/data.csv'] }));
    expect(parsed.content).toContain('a,b,c');
  });

  it('handles HTTP error status', async () => {
    const notFoundResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => null },
      text: () => Promise.resolve('Not found'),
    };
    mockFetch.mockResolvedValueOnce(notFoundResponse);
    mockFetch.mockResolvedValueOnce(notFoundResponse);

    const parsed = firstFetch(await executeWebFetch({ urls: ['https://example.com/missing'] }));
    expect(parsed.error).toContain('404');
  });

  it('summarizes HTML error pages instead of surfacing raw markup', async () => {
    const notFoundResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: {
        get: (name: string) => (name === 'content-type' ? 'text/html' : null),
      },
      text: () =>
        Promise.resolve(
          '<!DOCTYPE html><html><head><title>Example Missing Page</title></head><body><header>Site Nav</header><main><h1>Page not found</h1><p>The page you requested does not exist.</p></main><footer>Footer</footer></body></html>',
        ),
    };
    mockFetch.mockResolvedValueOnce(notFoundResponse);
    mockFetch.mockResolvedValueOnce(notFoundResponse);

    const parsed = firstFetch(
      await executeWebFetch({ urls: ['https://example.com/missing-html'] }),
    );

    expect(parsed.error).toContain('404');
    expect(parsed.error).toContain('Example Missing Page');
    expect(parsed.error).not.toContain('<!DOCTYPE html>');
    expect(parsed.error).not.toContain('<html');
  });

  it('uses firecrawl fallback when direct fetch fails and API key exists', async () => {
    // First fetch (direct) fails
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
    // Direct retry also fails
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
    // Firecrawl API key is available
    mockGetSecure.mockResolvedValue('fc-key-123');
    // Firecrawl API succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            markdown: '# Scraped content',
            metadata: { title: 'Page Title' },
          },
        }),
    });

    const parsed = firstFetch(await executeWebFetch({ urls: ['https://example.com/hard'] }));
    expect(parsed.source).toBe('firecrawl');
    expect(parsed.content).toContain('Scraped content');
    expect(parsed.title).toBe('Page Title');
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://api.firecrawl.dev/v1/scrape',
      expect.objectContaining({
        credentials: 'omit',
        method: 'POST',
      }),
    );
  });

  it('returns combined error when both direct and firecrawl fail', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Direct fail'));
    mockFetch.mockRejectedValueOnce(new Error('Direct fail retry'));
    mockGetSecure.mockResolvedValue('fc-key');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const parsed = firstFetch(await executeWebFetch({ urls: ['https://example.com/bad'] }));
    expect(parsed.error).toBe('Fetch failed after direct and fallback attempts.');
    expect(parsed.directError).toContain('Direct fail');
    expect(parsed.fallbackError).toContain('HTTP 500');
  });

  it('returns direct error when no firecrawl key and direct fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection timeout'));
    mockFetch.mockRejectedValueOnce(new Error('Connection timeout'));
    mockGetSecure.mockResolvedValue(null);

    const parsed = firstFetch(await executeWebFetch({ urls: ['https://example.com/timeout'] }));
    expect(parsed.error).toContain('Connection timeout');
  });

  it('retries direct fetch with fallback headers before failing over', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Primary fetch rejected')).mockResolvedValueOnce({
      ok: true,
      url: 'https://example.com/retry',
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/plain' : null),
      },
      text: () => Promise.resolve('fallback success'),
    });

    const parsed = firstFetch(await executeWebFetch({ urls: ['https://example.com/retry'] }));
    expect(parsed.content).toBe('fallback success');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('respects extractMode parameter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      url: 'https://example.com',
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/html' : null),
      },
      text: () =>
        Promise.resolve(
          '<html><body><main><h1>Heading</h1><p>Content</p></main></body></html>',
        ),
    });

    const parsed = firstFetch(
      await executeWebFetch({ urls: ['https://example.com'], extractMode: 'text' }),
    );
    expect(parsed.url).toBe('https://example.com');
    expect(parsed.content).toBe('Heading\nContent');
  });

  it('respects maxChars parameter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      url: 'https://example.com',
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/plain' : null),
      },
      text: () => Promise.resolve('x'.repeat(500)),
    });

    const parsed = firstFetch(
      await executeWebFetch({ urls: ['https://example.com'], maxChars: 200 }),
    );
    expect(parsed.charCount).toBe(500);
    expect(parsed.content.length).toBeLessThanOrEqual(200);
    expect(parsed.truncated).toBe(true);
  });

  it('uses the lower default maxChars budget when maxChars is omitted', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      url: 'https://example.com',
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/plain' : null),
      },
      text: () => Promise.resolve('x'.repeat(25_000)),
    });

    const parsed = firstFetch(await executeWebFetch({ urls: ['https://example.com'] }));
    expect(parsed.charCount).toBe(25_000);
    expect(parsed.content.length).toBeLessThanOrEqual(20_000);
    expect(parsed.truncated).toBe(true);
  });

  it('caches results and returns cached data on second call', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      url: 'https://cache-test.com',
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/plain' : null),
      },
      text: () => Promise.resolve('cached content'),
    });

    // First call
    await executeWebFetch({ urls: ['https://cache-test.com'] });
    // Second call should use cache
    const parsed = firstFetch(await executeWebFetch({ urls: ['https://cache-test.com'] }));
    expect(parsed.content).toBe('cached content');
    // fetch should only have been called once (cached second time)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handles non-Error throw from direct fetch', async () => {
    // Both header profiles throw a string (not an Error)
    mockFetch.mockRejectedValueOnce('network down');
    mockFetch.mockRejectedValueOnce('network down');
    mockGetSecure.mockResolvedValue(null);

    const parsed = firstFetch(
      await executeWebFetch({ urls: ['https://example.com/string-throw'] }),
    );
    expect(parsed.error).toContain('network down');
  });

  it('handles non-Error throw from both direct and firecrawl', async () => {
    mockFetch.mockRejectedValueOnce({ code: 'ECONNRESET' });
    mockFetch.mockRejectedValueOnce({ code: 'ECONNRESET' });
    mockGetSecure.mockResolvedValue('fc-key');
    // Firecrawl also throws non-Error
    mockFetch.mockRejectedValueOnce(404);

    const parsed = firstFetch(await executeWebFetch({ urls: ['https://example.com/obj-throw'] }));
    expect(parsed.error).toBe('Fetch failed after direct and fallback attempts.');
    expect(parsed.directError).toContain('ECONNRESET');
    expect(parsed.fallbackError).toContain('404');
  });

  it('firecrawl gets its own signal when direct fetch times out', async () => {
    // Direct fetch aborts (both header profiles fail)
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortError); // profile 1
    mockFetch.mockRejectedValueOnce(abortError); // profile 2

    // Firecrawl should succeed with its own independent signal
    mockGetSecure.mockResolvedValue('fc-api-key');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { markdown: 'Firecrawl content', metadata: { title: 'FC' } },
        }),
    });

    const parsed = firstFetch(
      await executeWebFetch({ urls: ['https://example.com/timeout-test'] }),
    );
    // Firecrawl should have succeeded despite direct fetch abort
    expect(parsed.content).toContain('Firecrawl content');
    expect(parsed.error).toBeUndefined();
  });

  it('prefers main document content over structural chrome in HTML pages', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      url: 'https://example.com/docs',
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/html' : null),
      },
      text: () =>
        Promise.resolve(`<!doctype html>
          <html>
            <head><title>Docs</title></head>
            <body>
              <header><a href="/home">Home</a></header>
              <nav><a href="/nav">Navigation</a></nav>
              <main>
                <article>
                  <h1>Official Docs</h1>
                  <p>Main content only.</p>
                </article>
              </main>
              <footer>Footer links</footer>
            </body>
          </html>`),
    });

    const parsed = firstFetch(await executeWebFetch({ urls: ['https://example.com/docs'] }));
    expect(parsed.title).toBe('Docs');
    expect(parsed.content).toContain('Official Docs');
    expect(parsed.content).toContain('Main content only.');
    expect(parsed.content).not.toContain('Navigation');
    expect(parsed.content).not.toContain('Footer links');
  });

  it('fetches multiple URLs in one call and preserves order', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://example.com/one',
        headers: {
          get: (h: string) => (h === 'content-type' ? 'text/plain' : null),
        },
        text: () => Promise.resolve('first'),
      })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://example.com/two',
        headers: {
          get: (h: string) => (h === 'content-type' ? 'text/plain' : null),
        },
        text: () => Promise.resolve('second'),
      });

    const parsed = JSON.parse(
      await executeWebFetch({
        urls: ['https://example.com/one', 'https://example.com/two'],
      }),
    );

    expect(parsed.fetches).toHaveLength(2);
    expect(parsed.fetches[0].url).toBe('https://example.com/one');
    expect(parsed.fetches[0].content).toBe('first');
    expect(parsed.fetches[1].url).toBe('https://example.com/two');
    expect(parsed.fetches[1].content).toBe('second');
  });
});
