const { readFileSync } = require('fs');
const { join } = require('path');

const projectRoot = join(__dirname, '../..');
const packageJson = require('../../package.json');
const publicReleaseDate = '2026-06-20';

function readRepoFile(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

describe('public changelog', () => {
  const changelog = readRepoFile('CHANGELOG.md');

  it('keeps the latest release aligned with public app metadata', () => {
    const latestHeading = changelog.match(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/m);

    expect(latestHeading).not.toBeNull();
    expect(latestHeading?.[1]).toBe(packageJson.version);
    expect(latestHeading?.[2]).toBe(publicReleaseDate);
  });

  it('uses the expected public release-note sections', () => {
    // Sections are asserted per release. An [Unreleased] block is allowed to carry
    // pending notes, but a tagged release keeps the exact public section set so a
    // published changelog cannot drift into ad-hoc headings.
    const releaseBody = changelog.slice(changelog.search(/^## \[[^\]]+\] - \d{4}-\d{2}-\d{2}$/m));
    const releaseSections = Array.from(releaseBody.matchAll(/^### (.+)$/gm), (match) => match[1]);

    expect(releaseSections).toEqual(['Added', 'Changed', 'Security', 'Tests']);

    const unreleasedBody = changelog.slice(0, changelog.search(/^## \[[^\]]+\] - \d{4}-\d{2}-\d{2}$/m));
    for (const heading of Array.from(unreleasedBody.matchAll(/^### (.+)$/gm), (m) => m[1])) {
      expect(['Added', 'Changed', 'Fixed', 'Removed', 'Security', 'Tests']).toContain(heading);
    }
  });

  it('summarizes contributor-visible capability and maintenance areas', () => {
    expect(changelog).toContain('Mobile-only assistant app');
    expect(changelog).toMatch(/no\s+required\s+Kavi\s+server\s+or\s+gateway/);
    expect(changelog).toContain('ClawHub-compatible skill discovery');
    expect(changelog).toContain('MCP servers');
    expect(changelog).toContain('On-device Gemma runtime support');
    expect(changelog).toMatch(/repository\s+guardrails/);
    expect(changelog).toMatch(/release\s+checklist expectations/);
  });

  it('does not contain internal release-preparation language', () => {
    const blockedTerms = [
      ['_re', 'search'].join(''),
      ['Ch', 'unk'].join(''),
      ['plan', 'section'].join(' '),
      ['agent', 'quality', 'roadmap'].join('-'),
      ['SO', 'TA'].join(''),
      ['Open', 'Claw'].join(''),
    ];

    for (const blockedTerm of blockedTerms) {
      expect(changelog).not.toMatch(new RegExp(blockedTerm, 'i'));
    }
  });
});
