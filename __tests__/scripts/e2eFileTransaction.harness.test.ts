import { spawn } from 'child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import {
  acquireFileLockSync,
  atomicWriteFileSync,
  removeManagedTransactionResidueSync,
  replaceDirectoryFromStagingSync,
  uniqueManagedPath,
} from '../../scripts/e2eReport/fileTransaction';
import { parseOptionalStrictPositiveInteger } from '../../scripts/e2eReport/configParsing';

describe('evaluation artifact file transactions', () => {
  it('parses retention limits identically as strict positive base-10 integers', () => {
    expect(parseOptionalStrictPositiveInteger(undefined, 'retention')).toBeUndefined();
    expect(parseOptionalStrictPositiveInteger(' 12 ', 'retention')).toBe(12);
    for (const value of ['0', '-1', '1.5', '1e2', '1junk', '9007199254740992']) {
      expect(() => parseOptionalStrictPositiveInteger(value, 'retention')).toThrow('retention');
    }
  });

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

  it('restores the last valid run when a crash stranded its replacement backup', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kavi-e2e-run-recovery-'));
    const target = join(directory, 'run-current');
    const backup = uniqueManagedPath(directory, 'run-current', 'backup');
    mkdirSync(target);
    writeFileSync(join(target, 'report.json'), 'last-valid', 'utf8');
    mkdirSync(uniqueManagedPath(directory, 'run-current', 'staging'));
    // This is the crash window after the live run moved aside but before staging promotion.
    renameSync(target, backup);

    try {
      removeManagedTransactionResidueSync(directory, 'run-current');

      expect(readFileSync(join(target, 'report.json'), 'utf8')).toBe('last-valid');
      expect(readdirSync(directory)).toEqual(['run-current']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('recovers a stale lock and releases its replacement exactly once', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kavi-e2e-lock-'));
    const lockPath = join(directory, '.artifact.lock');
    const staleLockDirectory = `${lockPath}.lock`;
    mkdirSync(staleLockDirectory);
    const staleAt = new Date(Date.now() - 10_000);
    utimesSync(staleLockDirectory, staleAt, staleAt);

    try {
      const release = acquireFileLockSync(lockPath, { timeoutMs: 250, staleMs: 5_000 });
      release();
      release();

      expect(readdirSync(directory)).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps a synchronous lock heartbeat fresh while the event loop is blocked', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kavi-e2e-lock-heartbeat-'));
    const lockPath = join(directory, '.artifact.lock');

    try {
      const release = acquireFileLockSync(lockPath, { timeoutMs: 250, staleMs: 5_000 });
      const lockDirectory = `${lockPath}.lock`;
      const initialMtimeMs = statSync(lockDirectory).mtimeMs;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3_000);

      expect(statSync(lockDirectory).mtimeMs).toBeGreaterThan(initialMtimeMs);
      release();
      expect(readdirSync(directory)).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('serializes concurrent read-modify-write transactions across processes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'kavi-e2e-lock-concurrency-'));
    const statePath = join(directory, 'state.json');
    const lockPath = join(directory, '.state.lock');
    const transactionModule = resolve(__dirname, '../../scripts/e2eReport/fileTransaction.js');
    atomicWriteFileSync(statePath, JSON.stringify({ count: 0 }), 'utf8');
    const worker = `
      const fs = require('fs');
      const { atomicWriteFileSync, withFileLockSync } = require(${JSON.stringify(
        transactionModule,
      )});
      const statePath = ${JSON.stringify(statePath)};
      const lockPath = ${JSON.stringify(lockPath)};
      for (let index = 0; index < 20; index += 1) {
        withFileLockSync(lockPath, () => {
          const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          atomicWriteFileSync(statePath, JSON.stringify({ count: state.count + 1 }), 'utf8');
        });
      }
    `;

    const runWorker = () =>
      new Promise<void>((resolveWorker, rejectWorker) => {
        const child = spawn(process.execPath, ['-e', worker], { stdio: 'pipe' });
        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += String(chunk);
        });
        child.on('error', rejectWorker);
        child.on('close', (status) => {
          if (status === 0) resolveWorker();
          else rejectWorker(new Error(`transaction worker failed (${status}): ${stderr}`));
        });
      });

    try {
      await Promise.all([runWorker(), runWorker()]);

      expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({ count: 40 });
      expect(readdirSync(directory)).toEqual(['state.json']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
