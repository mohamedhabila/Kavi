const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const projectRoot = join(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

describe('community health files', () => {
  it('keeps required community files present', () => {
    const requiredFiles = [
      'LICENSE',
      'SECURITY.md',
      'CODE_OF_CONDUCT.md',
      'CONTRIBUTING.md',
      '.github/PULL_REQUEST_TEMPLATE.md',
      '.github/ISSUE_TEMPLATE/bug_report.yml',
      '.github/ISSUE_TEMPLATE/feature_request.yml',
      '.github/ISSUE_TEMPLATE/config.yml',
    ];

    for (const relativePath of requiredFiles) {
      expect(existsSync(join(projectRoot, relativePath))).toBe(true);
    }
  });

  it('keeps licensing and conduct ownership public', () => {
    const license = readRepoFile('LICENSE');
    const conduct = readRepoFile('CODE_OF_CONDUCT.md');

    expect(license).toContain('MIT License');
    expect(license).toContain('Kavi contributors');
    expect(conduct).toContain('non-public contact path');
    expect(conduct).toContain('repository or owner profile');
    expect(conduct).toContain('Contributor Covenant');
  });

  it('routes security-sensitive reports away from public issues', () => {
    const security = readRepoFile('SECURITY.md');
    const bugTemplate = readRepoFile('.github/ISSUE_TEMPLATE/bug_report.yml');
    const contributing = readRepoFile('CONTRIBUTING.md');

    expect(security).toContain('Please do not open a public issue');
    expect(security).toContain('private vulnerability reporting');
    expect(security).toContain('non-public contact path');
    expect(security).toContain('repository or owner profile');
    expect(bugTemplate).toMatch(/body:\n\s+- type: markdown/);
    expect(bugTemplate).toContain('Security-sensitive reports do not belong in public issues');
    expect(bugTemplate).toContain('SECURITY.md');
    expect(bugTemplate).toContain(
      'Redact secrets, tokens, private data, hostnames, and credentials',
    );
    expect(contributing).toContain('For security reports, follow [SECURITY.md](SECURITY.md)');
  });

  it('keeps pull request verification aligned with contributor gates', () => {
    const pullRequestTemplate = readRepoFile('.github/PULL_REQUEST_TEMPLATE.md');

    expect(pullRequestTemplate).toContain('npm run verify');
    expect(pullRequestTemplate).toContain('npm run verify:strict');
    expect(pullRequestTemplate).toContain('agent, graph, memory, orchestration, or E2E harness');
    expect(pullRequestTemplate).toContain(
      'no secrets, private notes, or build artifacts were added',
    );
    expect(pullRequestTemplate).toContain('security-sensitive reports or repro details');
  });

  it('keeps issue templates scoped for external contributors', () => {
    const featureTemplate = readRepoFile('.github/ISSUE_TEMPLATE/feature_request.yml');
    const config = readRepoFile('.github/ISSUE_TEMPLATE/config.yml');

    expect(featureTemplate).toContain('Propose a user-facing or developer-facing improvement');
    expect(featureTemplate).toContain('Contribution interest');
    expect(featureTemplate).toMatch(/\bid: proposal\b/);
    expect(config).toContain('blank_issues_enabled: false');
  });
});
