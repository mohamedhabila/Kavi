// ---------------------------------------------------------------------------
// Tests — Web Fetch Tool
// ---------------------------------------------------------------------------

import { executeWebFetch } from '../../src/engine/tools/web-fetch';

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
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('executeWebFetch', () => {
  it('returns error when URL is empty', async () => {
    const result = await executeWebFetch({ url: '' });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('URL is required');
  });

  it('returns error when URL is blocked by SSRF', async () => {
    const result = await executeWebFetch({ url: 'http://internal.local' });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('security policy');
  });

  it('fetches HTML and converts to markdown', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Map([['content-type', 'text/html']]) as any,
      text: () =>
        Promise.resolve(
          '<html><head><title>Test Page</title></head><body><p>Hello world</p></body></html>',
        ),
    });

    const result = await executeWebFetch({ url: 'https://example.com' });
    const parsed = JSON.parse(result);
    expect(parsed.url).toBe('https://example.com');
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

  it('fetches JSON content directly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'application/json' : null),
      },
      text: () => Promise.resolve('{"key": "value"}'),
    });

    const result = await executeWebFetch({ url: 'https://api.example.com/data' });
    const parsed = JSON.parse(result);
    expect(parsed.content).toContain('key');
  });

  it('fetches plain text content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/plain' : null),
      },
      text: () => Promise.resolve('Plain text content here'),
    });

    const result = await executeWebFetch({ url: 'https://example.com/file.txt' });
    const parsed = JSON.parse(result);
    expect(parsed.content).toBe('Plain text content here');
  });

  it('fetches CSV content as plain text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/csv' : null),
      },
      text: () => Promise.resolve('a,b,c\n1,2,3'),
    });

    const result = await executeWebFetch({ url: 'https://example.com/data.csv' });
    const parsed = JSON.parse(result);
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

    const result = await executeWebFetch({ url: 'https://example.com/missing' });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('404');
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

    const result = await executeWebFetch({ url: 'https://example.com/hard' });
    const parsed = JSON.parse(result);
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
    mockGetSecure.mockResolvedValue('fc-key');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const result = await executeWebFetch({ url: 'https://example.com/bad' });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('Direct');
    expect(parsed.error).toContain('Firecrawl');
  });

  it('returns direct error when no firecrawl key and direct fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection timeout'));
    mockFetch.mockRejectedValueOnce(new Error('Connection timeout'));
    mockGetSecure.mockResolvedValue(null);

    const result = await executeWebFetch({ url: 'https://example.com/timeout' });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('Connection timeout');
  });

  it('retries direct fetch with fallback headers before failing over', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Primary fetch rejected')).mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/plain' : null),
      },
      text: () => Promise.resolve('fallback success'),
    });

    const result = await executeWebFetch({ url: 'https://example.com/retry' });
    const parsed = JSON.parse(result);
    expect(parsed.content).toBe('fallback success');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('respects extractMode parameter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/html' : null),
      },
      text: () => Promise.resolve('<html><body><p>Content</p></body></html>'),
    });

    const result = await executeWebFetch({ url: 'https://example.com', extractMode: 'text' });
    const parsed = JSON.parse(result);
    expect(parsed.url).toBe('https://example.com');
  });

  it('respects maxChars parameter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/plain' : null),
      },
      text: () => Promise.resolve('x'.repeat(500)),
    });

    const result = await executeWebFetch({ url: 'https://example.com', maxChars: 200 });
    const parsed = JSON.parse(result);
    expect(parsed.charCount).toBeLessThanOrEqual(200);
    expect(parsed.truncated).toBe(true);
  });

  it('caches results and returns cached data on second call', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/plain' : null),
      },
      text: () => Promise.resolve('cached content'),
    });

    // First call
    await executeWebFetch({ url: 'https://cache-test.com' });
    // Second call should use cache
    const result = await executeWebFetch({ url: 'https://cache-test.com' });
    const parsed = JSON.parse(result);
    expect(parsed.content).toBe('cached content');
    // fetch should only have been called once (cached second time)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handles non-Error throw from direct fetch', async () => {
    // Both header profiles throw a string (not an Error)
    mockFetch.mockRejectedValueOnce('network down');
    mockFetch.mockRejectedValueOnce('network down');
    mockGetSecure.mockResolvedValue(null);

    const result = await executeWebFetch({ url: 'https://example.com/string-throw' });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('network down');
  });

  it('handles non-Error throw from both direct and firecrawl', async () => {
    mockFetch.mockRejectedValueOnce({ code: 'ECONNRESET' });
    mockFetch.mockRejectedValueOnce({ code: 'ECONNRESET' });
    mockGetSecure.mockResolvedValue('fc-key');
    // Firecrawl also throws non-Error
    mockFetch.mockRejectedValueOnce(404);

    const result = await executeWebFetch({ url: 'https://example.com/obj-throw' });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('Direct');
    expect(parsed.error).toContain('Firecrawl');
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

    const result = await executeWebFetch({ url: 'https://example.com/timeout-test' });
    const parsed = JSON.parse(result);
    // Firecrawl should have succeeded despite direct fetch abort
    expect(parsed.content).toContain('Firecrawl content');
    expect(parsed.error).toBeUndefined();
  });
});
