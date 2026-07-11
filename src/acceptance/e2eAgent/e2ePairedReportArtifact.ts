import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import {
  atomicWriteFileSync,
  replaceDirectoryFromStagingSync,
  uniqueManagedPath,
  withFileLockSync,
} from '../../../scripts/e2eReport/fileTransaction';
import { buildE2EPairedPublicReport, type E2EPairedPublicReport } from './e2ePairedPublicReport';
import type { E2EPairedRuntimeResult } from './e2ePairedRuntime';

const PAIRED_REPORT_FILE = 'paired-report.json';
const SAFE_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export class E2EPairedClaimFailure extends Error {
  constructor(
    readonly runId: string,
    readonly reportRelativePath: string,
    readonly failureCount: number,
  ) {
    super(
      `Paired evaluation recorded ${failureCount} claim-blocking evidence failure(s); public evidence was written before failing.`,
    );
    this.name = 'E2EPairedClaimFailure';
  }
}

function requireRunId(value: string): string {
  if (
    !SAFE_RUN_ID_PATTERN.test(value) ||
    value === '.' ||
    value === '..' ||
    value !== value.trim()
  ) {
    throw new Error('Paired report runId must be a bounded path-free identifier.');
  }
  return value;
}

function resolveCanonicalRetentionRoot(retentionRoot: string): string {
  if (!retentionRoot || retentionRoot !== retentionRoot.trim()) {
    throw new Error('Paired report retentionRoot must be a non-empty canonical path.');
  }
  const requestedRoot = resolve(retentionRoot);
  mkdirSync(requestedRoot, { recursive: true });
  if (lstatSync(requestedRoot).isSymbolicLink()) {
    throw new Error('Paired report retentionRoot must not be a symlink.');
  }
  return realpathSync(requestedRoot);
}

function assertManagedRunPath(retentionRoot: string, runId: string): string {
  const runDir = resolve(retentionRoot, runId);
  if (dirname(runDir) !== retentionRoot) {
    throw new Error('Paired report run path escaped its retention root.');
  }
  if (existsSync(runDir) && lstatSync(runDir).isSymbolicLink()) {
    throw new Error('Paired report run directory must not be a symlink.');
  }
  return runDir;
}

function assertLockPathIsNotSymlink(lockPath: string): void {
  for (const candidate of [lockPath, `${lockPath}.lock`]) {
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
      throw new Error('Paired report lock path must not be a symlink.');
    }
  }
}

export function writeE2EPairedPublicReportArtifact(input: {
  runtime: E2EPairedRuntimeResult;
  retentionRoot: string;
  runId: string;
}): E2EPairedPublicReport {
  const runId = requireRunId(input.runId);
  const retentionRoot = resolveCanonicalRetentionRoot(input.retentionRoot);
  const runDir = assertManagedRunPath(retentionRoot, runId);
  const reportRelativePath = `${runId}/${PAIRED_REPORT_FILE}`;
  const report = buildE2EPairedPublicReport(input.runtime);

  const lockPath = join(retentionRoot, '.paired-report.lock');
  assertLockPathIsNotSymlink(lockPath);
  withFileLockSync(lockPath, () => {
    assertLockPathIsNotSymlink(lockPath);
    if (existsSync(runDir)) {
      throw new Error('Paired report runId already exists; retained evidence is immutable.');
    }
    const stagingDir = uniqueManagedPath(retentionRoot, runId, 'staging');
    mkdirSync(stagingDir, { recursive: false });
    try {
      atomicWriteFileSync(
        join(stagingDir, PAIRED_REPORT_FILE),
        JSON.stringify(report, null, 2),
        'utf8',
      );
      assertManagedRunPath(retentionRoot, runId);
      replaceDirectoryFromStagingSync(stagingDir, runDir);
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  });

  if (!report.validForDeltaClaims) {
    const failureCount =
      report.infrastructureFailures.length +
      Number(report.memoryPairedObservation.status === 'invalid_instrumentation');
    throw new E2EPairedClaimFailure(runId, reportRelativePath, failureCount);
  }
  return report;
}
