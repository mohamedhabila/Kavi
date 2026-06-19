// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executePdfRead
// ---------------------------------------------------------------------------

import { executePdfRead } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executePdfRead', () => {
    it('returns info for local PDF path', async () => {
      const result = await executePdfRead({ path: '/mock/docs/test.pdf' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('unsupported');
    });

    it('extracts text from HTML rendition', async () => {
      const htmlBody =
        '<html><body><p>Important document content here for testing extraction</p>' +
        '<p>Second paragraph with enough text to pass the 100 char minimum threshold</p></body></html>';
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: (h: string) => (h === 'content-type' ? 'text/html; charset=utf-8' : null) },
        text: jest.fn().mockResolvedValue(htmlBody),
      });

      const result = await executePdfRead({ path: 'https://example.com/doc.pdf' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('extracted');
      expect(parsed.method).toBe('html_rendition');
      expect(parsed.content).toContain('Important document content');
      delete (global as any).fetch;
    });

    it('fetches PDF from URL', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Map([
          ['content-type', 'application/pdf'],
          ['content-length', '12345'],
        ]),
        text: jest.fn().mockResolvedValue('PDF content here'),
      });
      // Make headers.get work like a real Headers object
      mockFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: (h: string) =>
            h === 'content-type' ? 'application/pdf' : h === 'content-length' ? '12345' : null,
        },
        text: jest.fn().mockResolvedValue('PDF content here'),
      });
      (global as any).fetch = mockFetch;

      const result = await executePdfRead({ path: 'https://example.com/doc.pdf' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('fetched_but_not_parsed');
      expect(parsed.suggestion).toContain('PDF text extraction');

      delete (global as any).fetch;
    });

    it('returns direct text for non-HTML non-PDF responses', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: (h: string) => (h === 'content-type' ? 'text/plain' : null) },
        text: jest.fn().mockResolvedValue('Plain text document content'),
      });

      const result = await executePdfRead({ path: 'https://example.com/doc.txt' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('extracted');
      expect(parsed.method).toBe('direct_text');
      expect(parsed.content).toContain('Plain text document');
      delete (global as any).fetch;
    });

    it('handles HTTP error status', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: () => null },
      });

      const result = await executePdfRead({ path: 'https://example.com/missing.pdf' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('HTTP 404');
      delete (global as any).fetch;
    });

    it('handles URL fetch error', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
      (global as any).fetch = mockFetch;

      const result = await executePdfRead({ path: 'https://example.com/fail.pdf' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Network error');

      delete (global as any).fetch;
    });
  });
});
