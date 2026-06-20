const { readFileSync } = require('fs');
const { join } = require('path');

const projectRoot = join(__dirname, '../..');
const packageJson = require('../../package.json');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

function verifyCommands(): string[] {
  return packageJson.scripts.verify.split(' && ').map((command: string) => command.trim());
}

describe('contributor documentation', () => {
  const legacyProjectPath = ['/path/to/open', 'claw-mobile'].join('');

  it('keeps the setup and testing docs aligned with the current verify gate', () => {
    const requiredCommands = verifyCommands();
    const docs = {
      'CONTRIBUTING.md': readRepoFile('CONTRIBUTING.md'),
      'docs/testing.md': readRepoFile('docs/testing.md'),
    };

    for (const content of Object.values(docs)) {
      for (const command of requiredCommands) {
        expect(content).toContain(command);
      }

      expect(content).toContain('npm run verify');
      expect(content).toContain('npm ci');
    }

    expect(docs['CONTRIBUTING.md']).toContain('npm run verify:strict');
    expect(docs['CONTRIBUTING.md']).toContain('docs/privacy-and-permissions.md');
  });

  it('documents CI as the same contributor gate contributors run locally', () => {
    const ciWorkflow = readRepoFile('.github/workflows/ci.yml');
    const readme = readRepoFile('README.md');
    const testingGuide = readRepoFile('docs/testing.md');

    expect(ciWorkflow).toContain('run: npm run verify');
    expect(ciWorkflow).toContain('run: npm ci');
    expect(readme).toContain('same contributor gate used by');
    expect(testingGuide).toContain('matches pull request CI');
    expect(testingGuide).toContain('.github/workflows/ci.yml');
  });

  it('documents local setup boundaries without private paths or keys', () => {
    const setupGuide = readRepoFile('docs/setup/development.md');
    const testingGuide = readRepoFile('docs/testing.md');
    const combinedDocs = [setupGuide, testingGuide].join('\n');

    expect(setupGuide).toContain('.env.local.example');
    expect(testingGuide).toContain('cp .env.local.example .env.local');
    expect(setupGuide).toContain('Android release environment check');
    expect(setupGuide).toContain('signing material');
    expect(testingGuide).toContain('Android release environment check');
    expect(testingGuide).toContain('npm run build:android:aab');
    expect(readRepoFile('README.md')).toContain('Selected-provider E2E');
    expect(setupGuide).toContain('npm run build:editor-assets');
    expect(combinedDocs).not.toContain(legacyProjectPath);
    expect(combinedDocs).not.toMatch(/sk-proj-[A-Za-z0-9_-]{20,}/);
  });
});
