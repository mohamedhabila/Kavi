const { mkdtempSync, mkdirSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const {
  extractMarkdownLinks,
  findMarkdownLinkFailures,
  isExternalOrAnchorTarget,
  resolveRelativeLink,
} = require('../../scripts/lib/markdownLinks');

describe('markdown link checks', () => {
  it('extracts inline and reference-style Markdown links', () => {
    const links = extractMarkdownLinks(
      [
        '[Guide](docs/testing.md)',
        '![Image](assets/icon.png "App icon")',
        '[Reference]: docs/setup/development.md',
      ].join('\n'),
    );

    expect(links).toEqual([
      { target: 'docs/testing.md', lineNumber: 1 },
      { target: 'assets/icon.png', lineNumber: 2 },
      { target: 'docs/setup/development.md', lineNumber: 3 },
    ]);
  });

  it('ignores external URLs and same-document anchors', () => {
    expect(isExternalOrAnchorTarget('https://example.com')).toBe(true);
    expect(isExternalOrAnchorTarget('mailto:security@example.com')).toBe(true);
    expect(isExternalOrAnchorTarget('#usage')).toBe(true);
    expect(isExternalOrAnchorTarget('docs/testing.md')).toBe(false);
  });

  it('resolves portable relative targets and blocks absolute local targets', () => {
    const projectRoot = '/repo';

    expect(resolveRelativeLink(projectRoot, 'docs/testing.md', '../README.md')).toMatchObject({
      relativePath: 'README.md',
    });
    expect(resolveRelativeLink(projectRoot, 'docs/testing.md', '/tmp/private.md')).toMatchObject({
      blocked: true,
    });
  });

  it('reports missing local targets without checking remote links', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'kavi-md-links-'));
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'README.md'),
      [
        '[Testing](docs/testing.md)',
        '[Missing](docs/missing.md)',
        '[External](https://example.com)',
      ].join('\n'),
    );
    writeFileSync(join(projectRoot, 'docs/testing.md'), '# Testing\n');

    const failures = findMarkdownLinkFailures(projectRoot, ['README.md']);

    expect(failures).toEqual([
      {
        filePath: 'README.md',
        lineNumber: 2,
        target: 'docs/missing.md',
        message: 'missing target docs/missing.md',
      },
    ]);
  });
});
