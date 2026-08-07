// ---------------------------------------------------------------------------
// Tests — Web Fetch Utils (HTML→Markdown, text transforms)
// ---------------------------------------------------------------------------

import {
  htmlToMarkdown,
  markdownToText,
  selectMatchingRegions,
  sliceTextWindow,
  truncateText,
} from '../../src/engine/tools/web-fetch-utils';

describe('htmlToMarkdown', () => {
  it('extracts title', () => {
    const { title } = htmlToMarkdown(
      '<html><head><title>My Page</title></head><body>Hello</body></html>',
    );
    expect(title).toBe('My Page');
  });

  it('converts headings', () => {
    const { text } = htmlToMarkdown('<h1>Title</h1><h2>Subtitle</h2>');
    expect(text).toContain('# Title');
    expect(text).toContain('## Subtitle');
  });

  it('converts links', () => {
    const { text } = htmlToMarkdown('<a href="https://example.com">Click here</a>');
    expect(text).toContain('[Click here](https://example.com)');
  });

  it('resolves relative links against the fetched page url', () => {
    const { text } = htmlToMarkdown(
      '<a href="/api/docs/api-reference/responses">Responses API</a>',
      'markdown',
      'https://developers.openai.com/api/docs/guides/migrate-to-responses',
    );

    expect(text).toContain(
      '[Responses API](https://developers.openai.com/api/docs/api-reference/responses)',
    );
  });

  it('converts list items', () => {
    const { text } = htmlToMarkdown('<ul><li>Item 1</li><li>Item 2</li></ul>');
    expect(text).toContain('- Item 1');
    expect(text).toContain('- Item 2');
  });

  it('strips scripts and styles', () => {
    const { text } = htmlToMarkdown('<script>alert("x")</script><style>.x{}</style><p>Content</p>');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('.x{}');
    expect(text).toContain('Content');
  });

  it('prefers nested article content over outer main chrome', () => {
    const { text } = htmlToMarkdown(
      '<main><nav>Docs nav</nav><article><h1>Real content</h1><p>Useful paragraph.</p></article><aside>On this page</aside></main>',
    );

    expect(text).toContain('Real content');
    expect(text).toContain('Useful paragraph.');
    expect(text).not.toContain('Docs nav');
    expect(text).not.toContain('On this page');
  });

  it('strips semantic role-based chrome containers', () => {
    const { text } = htmlToMarkdown(
      '<body><div role="navigation">Site nav</div><section role="search">Search box</section><article><p>Body copy</p></article><div role="contentinfo">Footer links</div></body>',
    );

    expect(text).toContain('Body copy');
    expect(text).not.toContain('Site nav');
    expect(text).not.toContain('Search box');
    expect(text).not.toContain('Footer links');
  });

  it('chooses the richest article instead of the first shallow control article', () => {
    const { text } = htmlToMarkdown(`
      <body>
        <div hidden id="S:0">
          <article>
            <button>Copy page</button>
            <button>Open menu</button>
          </article>
          <article>
            <h1>Define tools</h1>
            <p>Specify tool schemas, write effective descriptions, and control when Claude calls your tools.</p>
            <p>Client tools are specified in the tools top-level parameter, and each definition includes a name, description, and input schema.</p>
          </article>
        </div>
      </body>
    `);

    expect(text).toContain('Define tools');
    expect(text).toContain('Specify tool schemas');
    expect(text).toContain('Client tools are specified');
    expect(text).not.toContain('Copy page');
  });

  it('preserves hidden streamed body content when it is the only document content', () => {
    const { text } = htmlToMarkdown(`
      <body>
        <div hidden id="streamed-content">
          <p>Streamed server-rendered documentation content can be hidden in the HTML shell before hydration.</p>
          <p>This content still needs to be extracted so the model can continue working from the fetched page.</p>
        </div>
      </body>
    `);

    expect(text).toContain('Streamed server-rendered documentation content');
    expect(text).toContain('the model can continue working from the fetched page');
  });

  it('decodes HTML entities', () => {
    const { text } = htmlToMarkdown('<p>&amp; &lt; &gt; &quot;</p>');
    expect(text).toContain('&');
    expect(text).toContain('<');
    expect(text).toContain('>');
  });

  it('handles empty input', () => {
    const { text, title } = htmlToMarkdown('');
    expect(text).toBe('');
    expect(title).toBeUndefined();
  });
});

describe('markdownToText', () => {
  it('removes links keeping text', () => {
    expect(markdownToText('[Click](http://example.com)')).toContain('Click');
    expect(markdownToText('[Click](http://example.com)')).not.toContain('http://');
  });

  it('removes images', () => {
    expect(markdownToText('![alt](image.png)')).not.toContain('image.png');
  });

  it('strips code fences', () => {
    expect(markdownToText('```js\nconst x = 1;\n```')).toContain('const x = 1;');
    expect(markdownToText('```js\nconst x = 1;\n```')).not.toContain('```');
  });

  it('strips heading markers', () => {
    expect(markdownToText('## Title')).toBe('Title');
  });

  it('strips inline code backticks', () => {
    expect(markdownToText('Use `const`')).toContain('Use const');
  });
});

describe('truncateText', () => {
  it('returns full text when under limit', () => {
    expect(truncateText('hello', 100)).toEqual({ text: 'hello', truncated: false });
  });

  it('truncates at maxChars', () => {
    const result = truncateText('hello world', 5);
    expect(result.text).toBe('hello');
    expect(result.truncated).toBe(true);
  });

  it('preserves tail context when truncating', () => {
    const result = truncateText('abcdefghijABCDEFGHIJabcdefghijABCDEFGHIJ', 32);
    expect(result.text).toContain('a');
    expect(result.text).toContain('IJ');
    expect(result.text).toContain('[truncated');
    expect(result.truncated).toBe(true);
  });

  it('handles exact length', () => {
    expect(truncateText('hello', 5)).toEqual({ text: 'hello', truncated: false });
  });
});

describe('sliceTextWindow', () => {
  // A page longer than the budget used to return a head-and-tail excerpt with no way
  // to reach the middle. Traced on device: the model needed one infobox field that
  // fell in the gap, and its only recourse was to re-fetch — three times, each costing
  // a full model turn, still without the field.
  const DOC = Array.from({ length: 100 }, (_, i) => `line-${i}`).join('\n');

  it('returns the whole document when it fits', () => {
    const window = sliceTextWindow(DOC, 0, DOC.length + 10);

    expect(window.text).toBe(DOC);
    expect(window.truncated).toBe(false);
    expect(window.totalChars).toBe(DOC.length);
    expect(window.nextOffset).toBeUndefined();
  });

  it('reports how to continue when the document is longer than the window', () => {
    const window = sliceTextWindow(DOC, 0, 50);

    expect(window.text).toBe(DOC.slice(0, 50));
    expect(window.truncated).toBe(true);
    expect(window.totalChars).toBe(DOC.length);
    expect(window.nextOffset).toBe(50);
  });

  it('returns a contiguous window rather than a head-and-tail excerpt', () => {
    // Contiguity is what makes the content usable: a spliced excerpt corrupts JSON and
    // silently hides whatever sat between the two halves.
    const window = sliceTextWindow(DOC, 50, 40);

    expect(window.text).toBe(DOC.slice(50, 90));
    expect(DOC).toContain(window.text);
  });

  it('walks the entire document across successive windows with no gap or overlap', () => {
    let offset = 0;
    let assembled = '';
    for (let guard = 0; guard < 50; guard += 1) {
      const window = sliceTextWindow(DOC, offset, 37);
      assembled += window.text;
      if (!window.truncated) break;
      offset = window.nextOffset!;
    }

    expect(assembled).toBe(DOC);
  });

  it('clamps an offset past the end instead of failing', () => {
    const window = sliceTextWindow(DOC, DOC.length + 500, 20);

    expect(window.text).toBe('');
    expect(window.truncated).toBe(false);
    expect(window.offset).toBe(DOC.length);
  });

  it('treats a negative or non-finite offset as the start', () => {
    expect(sliceTextWindow(DOC, -10, 20).offset).toBe(0);
    expect(sliceTextWindow(DOC, Number.NaN, 20).offset).toBe(0);
  });
});

describe('selectMatchingRegions', () => {
  // Traced on device: eight fetches across five sources hunting a single diameter,
  // none reading past the first window of any page. A positional window cannot answer
  // "where is this value" — the model cannot know whether it sits at offset 20,000 or
  // 120,000, so guessing another URL is cheaper than guessing an offset.
  const DOC = [
    'x'.repeat(30_000),
    'Titan has a mean radius of 2,574.73 km which makes it the largest.',
    'y'.repeat(30_000),
  ].join('\n');

  it('finds a value buried far past the first window', () => {
    const result = selectMatchingRegions(DOC, 'mean radius', 5_000);

    expect(result.matchCount).toBe(1);
    expect(result.text).toContain('2,574.73 km');
  });

  it('reports absence so the model switches source instead of guessing again', () => {
    const result = selectMatchingRegions(DOC, 'orbital eccentricity', 5_000);

    expect(result.matchCount).toBe(0);
    expect(result.text).toBe('');
    expect(result.totalChars).toBe(DOC.length);
  });

  it('matches case-insensitively', () => {
    expect(selectMatchingRegions(DOC, 'MEAN RADIUS', 5_000).matchCount).toBe(1);
  });

  it('keeps surrounding context so the value stays interpretable', () => {
    const result = selectMatchingRegions(DOC, '2,574.73', 5_000);

    expect(result.text).toContain('Titan');
    expect(result.text).toContain('mean radius');
  });

  it('merges overlapping matches instead of repeating the same text', () => {
    const dense = 'radius here and radius again within the same neighbourhood.';
    const result = selectMatchingRegions(dense, 'radius', 5_000);

    expect(result.matchCount).toBe(1);
    expect(result.text).toBe(dense);
  });

  it('separates distant matches so regions stay distinguishable', () => {
    const spread = `alpha marker one${'z'.repeat(5_000)}marker two omega`;
    const result = selectMatchingRegions(spread, 'marker', 20_000);

    expect(result.matchCount).toBe(2);
    expect(result.text).toContain('…');
  });

  it('never exceeds the caller budget', () => {
    const result = selectMatchingRegions(DOC, 'mean radius', 100);

    expect(result.text.length).toBeLessThanOrEqual(100);
  });

  it('treats a blank query as no query rather than matching everything', () => {
    expect(selectMatchingRegions(DOC, '   ', 5_000).matchCount).toBe(0);
  });
});
