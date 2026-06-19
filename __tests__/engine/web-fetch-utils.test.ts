// ---------------------------------------------------------------------------
// Tests — Web Fetch Utils (HTML→Markdown, text transforms)
// ---------------------------------------------------------------------------

import {
  htmlToMarkdown,
  markdownToText,
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
