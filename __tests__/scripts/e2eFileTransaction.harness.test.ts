import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  acquireFileLockSync,
  atomicWriteFileSync,
  removeManagedTransactionResidueSync,
  replaceDirectoryFromStagingSync,
  uniqueManagedPath,
} from '../../scripts/e2eReport/fileTransaction';

describe('evaluation artifact file transactions', () => {
  it('atomically replaces files without leaving managed temporary files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kavi-e2e-atomic-file-'));
    const target = join(directory, 'report.json');
    writeFileSync(target, 'old', 'utf8');

    try {
      atomicWriteFileSync(target, 'new', 'utf8');

      expect(readFileSync(target, 'utf8')).toBe('new');
      expect(readdirSync(directory)).toEqual(['report.json']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('replaces an existing run directory and removes stale transaction residue', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kavi-e2e-atomic-run-'));
    const target = join(directory, 'run-current');
    const staging = uniqueManagedPath(directory, 'run-current', 'staging');
    const staleStaging = uniqueManagedPath(directory, 'run-current', 'staging');
    mkdirSync(target);
    mkdirSync(staging);
    mkdirSync(staleStaging);
    writeFileSync(join(target, 'stale-private.json'), 'private', 'utf8');
    writeFileSync(join(staging, 'report.json'), 'current', 'utf8');

    try {
      replaceDirectoryFromStagingSync(staging, target);
      removeManagedTransactionResidueSync(directory, 'run-current');

      expect(readFileSync(join(target, 'report.json'), 'utf8')).toBe('current');
      expect(readdirSync(target)).toEqual(['report.json']);
      expect(readdirSync(directory)).toEqual(['run-current']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('recovers a stale lock and releases its replacement exactly once', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kavi-e2e-lock-'));
    const lockPath = join(directory, '.artifact.lock');
    writeFileSync(lockPath, 'stale', 'utf8');

    try {
      const release = acquireFileLockSync(lockPath, { timeoutMs: 50, staleMs: 0 });
      release();
      release();

      expect(readdirSync(directory)).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
