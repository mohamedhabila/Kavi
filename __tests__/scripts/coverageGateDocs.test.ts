const { readFileSync } = require('fs');
const { join } = require('path');

const packageJson = require('../../package.json');
const projectRoot = join(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

function readNormalizedRepoFile(relativePath: string): string {
  return readRepoFile(relativePath).replace(/\s+/g, ' ');
}

describe('coverage gate documentation', () => {
  it('exposes coverage as a durable npm script without changing the PR gate', () => {
    expect(packageJson.scripts['test:coverage']).toBe('jest --runInBand --coverage --no-cache');
    expect(packageJson.scripts.verify).not.toContain('test:coverage');
    expect(packageJson.scripts.verify).not.toContain('--coverage');
  });

  it('keeps the Jest coverage baseline explicit', () => {
    expect(packageJson.jest.collectCoverageFrom).toContain('src/**/*.{ts,tsx}');
    expect(packageJson.jest.coverageDirectory).toBe('.tmp/coverage');
    expect(packageJson.jest.coverageReporters).toContain('json-summary');
    expect(packageJson.jest.coverageThreshold.global).toEqual({
      branches: 70.7,
      functions: 87.6,
      lines: 84.3,
      statements: 83.8,
    });
  });

  it('documents the coverage gate in contributor and release docs', () => {
    for (const relativePath of [
      'README.md',
      'CONTRIBUTING.md',
      'docs/testing.md',
      'docs/release.md',
    ]) {
      expect(readRepoFile(relativePath)).toContain('npm run test:coverage');
    }
    expect(readNormalizedRepoFile('docs/testing.md')).toContain('statements >=83.8%');
    expect(readNormalizedRepoFile('docs/testing.md')).toContain('Do not lower these floors');
    expect(readNormalizedRepoFile('docs/testing.md')).toContain(
      'Coverage reports are written under `.tmp/coverage`',
    );
    expect(readRepoFile('eslint.config.mjs')).toContain("'.tmp/**'");
    expect(readNormalizedRepoFile('docs/release.md')).toContain(
      'do not lower them for a release',
    );
  });
});
