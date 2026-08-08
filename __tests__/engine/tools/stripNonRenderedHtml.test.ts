import { htmlToMarkdown, stripNonRenderedHtml } from '../../../src/engine/tools/web-fetch-utils';
import { extractFetchedLinksFromHtml } from '../../../src/services/browser/core/linkExtractor';

// Measured on-device against en.wikipedia.org/wiki/Jupiter (1,415,879 chars):
// htmlToMarkdown 10,186 ms, extractFetchedLinksFromHtml 11,154 ms, network 186 ms.
// Both passes walked the raw payload; the link pass stripped nothing at all.

const PAGE = `
<html><head>
  <title>Jupiter</title>
  <style>.a{color:red}</style>
  <script>var trap = "<a href=\\"https://evil.example/script-link\\">script link</a>";</script>
  <!-- <a href="https://evil.example/comment-link">comment link</a> -->
</head><body>
  <main>
    <p>Jupiter is the largest planet.</p>
    <a href="https://example.com/real">Real source</a>
    <svg><a href="https://evil.example/svg-link"><text>icon</text></a></svg>
    <template><a href="https://evil.example/template-link">template link</a></template>
  </main>
</body></html>`;

describe('stripping markup that renders no text', () => {
  it('leaves the extracted markdown identical', () => {
    // htmlToMarkdown already discards these elements, so doing it earlier must be a
    // no-op for its output. This is the property the optimisation rests on.
    const before = htmlToMarkdown(PAGE, 'markdown', 'https://en.wikipedia.org/wiki/Jupiter');
    const after = htmlToMarkdown(
      stripNonRenderedHtml(PAGE),
      'markdown',
      'https://en.wikipedia.org/wiki/Jupiter',
    );

    expect(after.text).toBe(before.text);
    expect(after.title).toBe(before.title);
  });

  it('leaves the extracted text identical in text mode too', () => {
    const before = htmlToMarkdown(PAGE, 'text', 'https://example.com');
    const after = htmlToMarkdown(stripNonRenderedHtml(PAGE), 'text', 'https://example.com');

    expect(after.text).toBe(before.text);
  });

  it('shrinks what the later passes have to walk', () => {
    expect(stripNonRenderedHtml(PAGE).length).toBeLessThan(PAGE.length);
  });

  it('keeps real anchors and drops ones that were never navigable', () => {
    const links = extractFetchedLinksFromHtml(stripNonRenderedHtml(PAGE), 'https://example.com');
    const urls = (links ?? []).map((link) => link.url);

    expect(urls).toContain('https://example.com/real');
    expect(urls.join(' ')).not.toContain('script-link');
    expect(urls.join(' ')).not.toContain('comment-link');
    expect(urls.join(' ')).not.toContain('svg-link');
    expect(urls.join(' ')).not.toContain('template-link');
  });

  it('does not touch nav, header or footer, which carry real links', () => {
    // Narrower than stripStructuralChrome on purpose: that one is for prose extraction.
    const withNav = '<body><nav><a href="https://example.com/n">Nav</a></nav></body>';
    expect(stripNonRenderedHtml(withNav)).toContain('https://example.com/n');
  });

  it('handles empty input', () => {
    expect(stripNonRenderedHtml('')).toBe('');
  });
});
