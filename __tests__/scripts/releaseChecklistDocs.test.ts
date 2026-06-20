const { readFileSync } = require('fs');
const { join } = require('path');

function readReleaseChecklist(): string {
  return readFileSync(join(__dirname, '../../docs/release.md'), 'utf8');
}

describe('release maintainer checklist', () => {
  it('covers repository-host settings that cannot be committed', () => {
    const checklist = readReleaseChecklist();

    expect(checklist).toContain('branch protection or repository rules');
    expect(checklist).toContain('required checks');
    expect(checklist).toContain('private vulnerability reporting');
    expect(checklist).toContain('Dependabot alerts');
    expect(checklist).toContain('Dependabot security updates');
    expect(checklist).toContain('secret scanning');
    expect(checklist).toContain('push protection');
    expect(checklist).toContain('code scanning');
  });

  it('points maintainers to public security and conduct contact paths', () => {
    const checklist = readReleaseChecklist();

    expect(checklist).toContain('[SECURITY.md](../SECURITY.md)');
    expect(checklist).toContain('[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)');
    expect(checklist).toContain(
      'Issue templates should keep security-sensitive reports out of public issues.',
    );
  });

  it('keeps release verification aligned with current repository gates', () => {
    const checklist = readReleaseChecklist();

    expect(checklist).toContain('npm ci');
    expect(checklist).toContain('contributor gate with `npm run verify`');
    expect(checklist).toContain('npm run verify:strict');
    expect(checklist).toContain('npm run test:coverage');
    expect(checklist).toContain('npm audit --omit=dev --audit-level=high');
    expect(checklist).toContain('npm audit --audit-level=high');
    expect(checklist).toContain('npm run check:licenses');
    expect(checklist).toContain('npm run check:links');
    expect(checklist).toContain('npm run check:app-metadata');
    expect(checklist).toContain('THIRD_PARTY_NOTICES.md');
    expect(checklist).toContain('CHANGELOG.md');
  });

  it('documents build checks and maintainer-only signing boundaries', () => {
    const checklist = readReleaseChecklist();

    expect(checklist).toContain('npm run check:android:release-env');
    expect(checklist).toContain('npm run build:ios:release-sim');
    expect(checklist).toContain('KAVI_UPLOAD_STORE_FILE');
    expect(checklist).toContain('KAVI_UPLOAD_STORE_PASSWORD');
    expect(checklist).toContain('KAVI_UPLOAD_KEY_ALIAS');
    expect(checklist).toContain('KAVI_UPLOAD_KEY_PASSWORD');
    expect(checklist).toContain('npm run build:android:release');
    expect(checklist).toContain('npm run build:android:aab');
    expect(checklist).toContain('release-artifacts/');
    expect(checklist).toContain('never commit signing material');
  });

  it('documents tagging, GitHub release creation, and artifact handling', () => {
    const checklist = readReleaseChecklist();

    expect(checklist).toContain('git tag -a vX.Y.Z');
    expect(checklist).toContain('Create the GitHub release');
    expect(checklist).toContain('Attach only release artifacts built from the tagged commit');
    expect(checklist).toContain('Do not attach signing keys');
    expect(checklist).toContain('artifact checksums');
  });
});
