// ---------------------------------------------------------------------------
// Tests — Link Understanding: Service (runLinkUnderstanding)
// ---------------------------------------------------------------------------

import { runLinkUnderstanding } from '../../src/services/links/service';

// Mock the ssrf module
jest.mock('../../src/services/security/ssrf', () => ({
  isAllowedUrl: () => true,
}));

// Mock the web-fetch tool
const mockExecuteWebFetch = jest.fn();
jest.mock('../../src/engine/tools/web-fetch', () => ({
  executeWebFetch: (...args: any[]) => mockExecuteWebFetch(...args),
}));

beforeEach(() => {
  mockExecuteWebFetch.mockReset();
});

describe('runLinkUnderstanding', () => {
  it('returns original body when disabled', async () => {
    const result = await runLinkUnderstanding('Hello https://example.com', {
      enabled: false,
    });
    expect(result.enrichedBody).toBe('Hello https://example.com');
    expect(result.extractedCount).toBe(0);
  });

  it('returns original body when no URLs found', async () => {
    const result = await runLinkUnderstanding('No links here', {
      enabled: true,
    });
    expect(result.enrichedBody).toBe('No links here');
    expect(result.extractedCount).toBe(0);
  });

  it('extracts and enriches a single link', async () => {
    mockExecuteWebFetch.mockResolvedValue(
      JSON.stringify({
        fetches: [{ requestedUrl: 'https://example.com', title: 'Example', content: 'Page content here.' }],
      }),
    );

    const result = await runLinkUnderstanding('Check https://example.com', {
      enabled: true,
    });

    expect(result.extractedCount).toBe(1);
    expect(result.enrichedBody).toContain('<link_context>');
    expect(result.enrichedBody).toContain('Page content here.');
    expect(mockExecuteWebFetch).toHaveBeenCalledWith({
      urls: ['https://example.com'],
      extractMode: 'markdown',
      maxChars: 8000,
    });
  });

  it('handles multiple links in parallel', async () => {
    mockExecuteWebFetch.mockResolvedValue(
      JSON.stringify({
        fetches: [
          { requestedUrl: 'https://a.com', content: 'First.' },
          { requestedUrl: 'https://b.com', content: 'Second.' },
        ],
      }),
    );

    const result = await runLinkUnderstanding('See https://a.com and https://b.com', {
      enabled: true,
    });

    expect(result.extractedCount).toBe(2);
    expect(result.enrichedBody).toContain('First.');
    expect(result.enrichedBody).toContain('Second.');
    expect(mockExecuteWebFetch).toHaveBeenCalledTimes(1);
  });

  it('respects maxLinks option', async () => {
    mockExecuteWebFetch.mockResolvedValue(
      JSON.stringify({ fetches: [{ requestedUrl: 'https://a.com', content: 'Content.' }] }),
    );

    await runLinkUnderstanding('https://a.com https://b.com https://c.com', {
      enabled: true,
      maxLinks: 1,
    });

    expect(mockExecuteWebFetch).toHaveBeenCalledTimes(1);
  });

  it('gracefully handles fetch errors', async () => {
    mockExecuteWebFetch.mockRejectedValue(new Error('Network error'));

    const result = await runLinkUnderstanding('See https://fail.com', {
      enabled: true,
    });

    expect(result.extractedCount).toBe(0);
    expect(result.enrichedBody).toContain('Network error');
  });

  it('handles JSON response with error field', async () => {
    mockExecuteWebFetch.mockResolvedValue(JSON.stringify({ error: 'Rate limited' }));

    const result = await runLinkUnderstanding('See https://limited.com', {
      enabled: true,
    });

    expect(result.extractedCount).toBe(0);
    expect(result.enrichedBody).toContain('Rate limited');
  });

  it('preserves original body prefix in enriched result', async () => {
    const body = 'Please analyze this: https://example.com';
    mockExecuteWebFetch.mockResolvedValue(
      JSON.stringify({ fetches: [{ requestedUrl: 'https://example.com', content: 'Analyzed.' }] }),
    );

    const result = await runLinkUnderstanding(body, { enabled: true });

    expect(result.enrichedBody.startsWith(body)).toBe(true);
  });
});
