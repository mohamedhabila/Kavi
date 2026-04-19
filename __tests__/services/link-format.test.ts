// ---------------------------------------------------------------------------
// Tests — Link Understanding: Formatting
// ---------------------------------------------------------------------------

import { formatLinkUnderstandingBody, LinkExtractionResult } from '../../src/services/links/format';

describe('formatLinkUnderstandingBody', () => {
  const originalBody = 'Check out this link: https://example.com';

  it('returns original body when outputs array is empty', () => {
    const result = formatLinkUnderstandingBody(originalBody, []);
    expect(result).toBe(originalBody);
  });

  it('wraps content in link_context tags', () => {
    const outputs: LinkExtractionResult[] = [
      { url: 'https://example.com', content: 'Example domain content.' },
    ];
    const result = formatLinkUnderstandingBody(originalBody, outputs);
    expect(result).toContain('<link_context>');
    expect(result).toContain('</link_context>');
    expect(result).toContain('Example domain content.');
  });

  it('includes the original body at the start', () => {
    const outputs: LinkExtractionResult[] = [
      { url: 'https://example.com', content: 'Content here.' },
    ];
    const result = formatLinkUnderstandingBody(originalBody, outputs);
    expect(result.startsWith(originalBody)).toBe(true);
  });

  it('formats with title when available', () => {
    const outputs: LinkExtractionResult[] = [
      { url: 'https://example.com', title: 'Example Site', content: 'Some content.' },
    ];
    const result = formatLinkUnderstandingBody(originalBody, outputs);
    expect(result).toContain('[Example Site](https://example.com)');
  });

  it('formats without title using url fallback', () => {
    const outputs: LinkExtractionResult[] = [
      { url: 'https://example.com', content: 'Some content.' },
    ];
    const result = formatLinkUnderstandingBody(originalBody, outputs);
    expect(result).toContain('[Link: https://example.com]');
  });

  it('handles error results', () => {
    const outputs: LinkExtractionResult[] = [
      { url: 'https://fail.com', content: '', error: 'Connection refused' },
    ];
    const result = formatLinkUnderstandingBody(originalBody, outputs);
    expect(result).toContain('Failed to extract: Connection refused');
  });

  it('separates multiple results with dividers', () => {
    const outputs: LinkExtractionResult[] = [
      { url: 'https://a.com', content: 'First content.' },
      { url: 'https://b.com', content: 'Second content.' },
    ];
    const result = formatLinkUnderstandingBody(originalBody, outputs);
    expect(result).toContain('---');
    expect(result).toContain('First content.');
    expect(result).toContain('Second content.');
  });

  it('skips outputs with empty content and no error', () => {
    const outputs: LinkExtractionResult[] = [
      { url: 'https://empty.com', content: '' },
      { url: 'https://real.com', content: 'Real content.' },
    ];
    const result = formatLinkUnderstandingBody(originalBody, outputs);
    expect(result).not.toContain('empty.com');
    expect(result).toContain('Real content.');
  });
});
