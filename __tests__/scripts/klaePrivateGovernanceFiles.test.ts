import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const childProcess = require('child_process');

const { validatePrivateKlaeRelease } = require('../../scripts/lib/klaePrivateGovernance');
const { MAX_PRIVATE_EVALUATION_FILE_BYTES } = require('../../scripts/lib/privateEvaluationFiles');
const {
  createPrivateReleaseFixture,
  removePrivateReleaseFixture,
  savePrivateReleaseFixture,
} = require('../helpers/klaePrivateFixture');

const projectRoot = path.resolve(__dirname, '../..');

describe('private KLAE artifact containment', () => {
  let fixture: ReturnType<typeof createPrivateReleaseFixture>;
  let gitSpy: jest.SpyInstance;

  beforeEach(() => {
    fixture = createPrivateReleaseFixture(projectRoot);
    gitSpy = jest
      .spyOn(childProcess, 'execFileSync')
      .mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'rev-parse') return `${fixture.expected.appCommitSha}\n`;
        if (args[0] === 'status') return '';
        throw new Error(`Unexpected Git command: ${args.join(' ')}`);
      });
  });

  afterEach(() => {
    gitSpy.mockRestore();
    removePrivateReleaseFixture(fixture);
  });

  function validate() {
    return validatePrivateKlaeRelease({
      projectRoot: fixture.projectRoot,
      registryPath: fixture.registryPath,
      expected: fixture.expected,
    });
  }

  it('rejects path traversal even when the escaped file exists', () => {
    fixture.registry.splits[0].packPath = '../escaped.pack.json';
    savePrivateReleaseFixture(fixture, { writePacks: false });

    expect(validate()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('registry.splits[0].packPath: must match pattern'),
        'release.developmentPack: path traversal is prohibited',
      ]),
    );
  });

  it('rejects a symlinked pack even when its target remains inside private custody', () => {
    const developmentPath = path.join(fixture.directory, 'development.pack.json');
    fs.unlinkSync(developmentPath);
    fs.symlinkSync('locked-validation.pack.json', developmentPath);

    expect(validate()).toEqual(
      expect.arrayContaining(['release.developmentPack: symlink components are prohibited']),
    );
  });

  it('requires owner-only modes for private directories and files', () => {
    if (process.platform === 'win32') return;
    fs.chmodSync(fixture.directory, 0o750);
    expect(validate()).toEqual(
      expect.arrayContaining(['release.registry: private directory mode must be 0700']),
    );

    fs.chmodSync(fixture.directory, 0o700);
    fs.chmodSync(fixture.registryPath, 0o640);
    expect(validate()).toEqual(
      expect.arrayContaining(['release.registry: private file mode must be 0600']),
    );
  });

  it('checks immutable registry and pack byte digests', () => {
    fs.appendFileSync(path.join(fixture.directory, 'development.pack.json'), ' \n');
    const wrongRegistryDigest = fixture.expected.registrySha256;
    fixture.expected.registrySha256 = 'f'.repeat(64);

    expect(validate()).toEqual(
      expect.arrayContaining([
        'release.registrySha256: does not match the immutable registry bytes',
        'registry.splits.development.sha256: does not match the immutable pack bytes',
      ]),
    );
    fixture.expected.registrySha256 = wrongRegistryDigest;
  });

  it('rejects oversized private files before reading them into memory', () => {
    fs.truncateSync(
      path.join(fixture.directory, 'sealed-held-out.pack.json'),
      MAX_PRIVATE_EVALUATION_FILE_BYTES + 1,
    );

    expect(validate()).toEqual(
      expect.arrayContaining([
        `release.sealed_held_outPack: exceeds the ${MAX_PRIVATE_EVALUATION_FILE_BYTES}-byte private artifact limit`,
      ]),
    );
  });

  it('keeps the default contributor check independent from private packs', () => {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
    const result = spawnSync(process.execPath, ['./scripts/check-evaluation-contract.js'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('metadata-only registry template');
    expect(result.stderr).toBe('');
  });

  it('requires every explicit release identity argument', () => {
    const result = spawnSync(
      process.execPath,
      ['./scripts/check-evaluation-contract.js', '--private-release'],
      { cwd: projectRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('arguments: --registry is required');
    expect(result.stderr).toContain('arguments: --registry-sha is required');
    expect(result.stderr).toContain('arguments: --prompt-sha is required');
  });
});
