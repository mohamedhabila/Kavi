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

  it('handles exact length', () => {
    expect(truncateText('hello', 5)).toEqual({ text: 'hello', truncated: false });
  });
});
