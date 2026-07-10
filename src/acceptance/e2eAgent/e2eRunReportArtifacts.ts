import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';

import { parseOptionalStrictPositiveInteger } from '../../../scripts/e2eReport/configParsing';
import {
  atomicWriteFileSync,
  removeManagedTransactionResidueSync,
  replaceDirectoryFromStagingSync,
  uniqueManagedPath,
  withFileLockSync,
} from '../../../scripts/e2eReport/fileTransaction';
import type { PublicE2ERunReport } from '../../../scripts/e2eReport/publicRunReport';
import {
  RETAINED_RUN_MANIFEST_FILE,
  buildRetainedRunManifest,
  sha256,
  validateRetainedRunDirectory,
} from '../../../scripts/e2eReport/retainedRunManifest';

import {
  E2E_READINESS_ARTIFACT_RETENTION_RUNS,
  E2E_READINESS_DASHBOARD_VERSION,
} from './e2eReadinessDashboard';
import type { E2ERunReport } from './e2eRunReport';
import { writeE2ERedactedTraceArtifacts } from './e2eTraceArtifacts';

export const E2E_READINESS_ARTIFACT_RETENTION_DIR_ENV = 'E2E_READINESS_ARTIFACT_RETENTION_DIR';
export const E2E_READINESS_ARTIFACT_RETENTION_LIMIT_ENV = 'E2E_READINESS_ARTIFACT_RETENTION_LIMIT';

type E2EReadinessArtifactIndexEntry = {
  runId: string;
  generatedAt: string;
  gitSha: string;
  provider: string;
  model: string;
  manifestRelativePath: string;
  manifestSha256: string;
  reportRelativePath: string;
  dashboardRelativePath: string;
  passing: boolean;
  scenarioPassRate: number;
  pass1Rate: number;
};

function resolveReadinessArtifactRetentionLimit(env: NodeJS.ProcessEnv): number {
  return (
    parseOptionalStrictPositiveInteger(
      env[E2E_READINESS_ARTIFACT_RETENTION_LIMIT_ENV],
      'E2E readiness artifact retention limit',
    ) ?? E2E_READINESS_ARTIFACT_RETENTION_RUNS
  );
}

function sanitizeRunIdPart(value: string | undefined): string {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_.-]+/g, '-');
}

function isSafeRunId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== '.' &&
    value !== '..' &&
    value.length > 0 &&
    sanitizeRunIdPart(value) === value
  );
}

function normalizeCurrentReadinessIndexEntry(
  value: unknown,
): E2EReadinessArtifactIndexEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const entry = value as Partial<E2EReadinessArtifactIndexEntry>;
  if (
    !isSafeRunId(entry.runId) ||
    entry.reportRelativePath !== `${entry.runId}/report.json` ||
    entry.dashboardRelativePath !== `${entry.runId}/dashboard.json` ||
    typeof entry.generatedAt !== 'string' ||
    typeof entry.gitSha !== 'string' ||
    typeof entry.provider !== 'string' ||
    typeof entry.model !== 'string' ||
    entry.manifestRelativePath !== `${entry.runId}/${RETAINED_RUN_MANIFEST_FILE}` ||
    typeof entry.manifestSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(entry.manifestSha256) ||
    typeof entry.passing !== 'boolean' ||
    !Number.isFinite(entry.scenarioPassRate) ||
    !Number.isFinite(entry.pass1Rate)
  ) {
    return null;
  }
  return {
    runId: entry.runId,
    generatedAt: entry.generatedAt,
    gitSha: entry.gitSha,
    provider: entry.provider,
    model: entry.model,
    manifestRelativePath: entry.manifestRelativePath,
    manifestSha256: entry.manifestSha256,
    reportRelativePath: entry.reportRelativePath,
    dashboardRelativePath: entry.dashboardRelativePath,
    passing: entry.passing,
    scenarioPassRate: entry.scenarioPassRate!,
    pass1Rate: entry.pass1Rate!,
  };
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function readReadinessIndexState(indexPath: string): {
  currentRuns: E2EReadinessArtifactIndexEntry[];
  discardedRunIds: string[];
} {
  const index = readJsonFile<{ version?: string; runs?: unknown[] }>(indexPath, {
    version: E2E_READINESS_DASHBOARD_VERSION,
    runs: [],
  });
  if (!index || typeof index !== 'object' || !Array.isArray(index.runs)) {
    throw new Error('E2E readiness index is malformed.');
  }
  if (index.version !== E2E_READINESS_DASHBOARD_VERSION) {
    return {
      currentRuns: [],
      discardedRunIds: index.runs
        .map((run) =>
          run && typeof run === 'object' ? (run as { runId?: unknown }).runId : undefined,
        )
        .filter(isSafeRunId),
    };
  }
  const currentRuns = index.runs.map(normalizeCurrentReadinessIndexEntry);
  if (currentRuns.some((run) => run === null)) {
    throw new Error('E2E readiness index contains an invalid current-schema run.');
  }
  const validRuns = currentRuns as E2EReadinessArtifactIndexEntry[];
  const runIds = validRuns.map((run) => run.runId);
  if (new Set(runIds).size !== runIds.length) {
    throw new Error('E2E readiness index contains duplicate run ids.');
  }
  return { currentRuns: validRuns, discardedRunIds: [] };
}

function validateAndRecoverIndexedRunDirectories(
  retentionDir: string,
  runs: ReadonlyArray<E2EReadinessArtifactIndexEntry>,
): { currentRuns: E2EReadinessArtifactIndexEntry[]; discardedRunIds: string[] } {
  const currentRuns: E2EReadinessArtifactIndexEntry[] = [];
  const discardedRunIds: string[] = [];
  for (const run of runs) {
    try {
      removeManagedTransactionResidueSync(retentionDir, run.runId);
      if (validateRetainedRunDirectory(retentionDir, run)) {
        currentRuns.push(run);
      } else {
        discardedRunIds.push(run.runId);
      }
    } catch {
      discardedRunIds.push(run.runId);
    }
  }
  return { currentRuns, discardedRunIds };
}

function closeRetentionRoot(retentionDir: string, retainedRunIds: ReadonlySet<string>): void {
  const allowedEntries = new Set(['.artifact.lock.lock', 'index.json', ...retainedRunIds]);
  for (const entry of readdirSync(retentionDir)) {
    if (!allowedEntries.has(entry)) {
      rmSync(join(retentionDir, entry), { recursive: true, force: true });
    }
  }
}

export function writeE2EReadinessDashboardArtifacts(
  resolvedReportPath: string,
  report: E2ERunReport,
  env: NodeJS.ProcessEnv = process.env,
): { dashboardPath: string; runDir: string; indexPath: string; report: PublicE2ERunReport } {
  const dashboardPath = `${resolvedReportPath}.dashboard.json`;
  const retentionDir = resolve(
    env[E2E_READINESS_ARTIFACT_RETENTION_DIR_ENV]?.trim() ||
      join(dirname(resolvedReportPath), 'e2e-readiness-runs'),
  );
  const runId = `run-${sanitizeRunIdPart(report.generatedAt)}-${sanitizeRunIdPart(
    report.runMetadata.gitSha,
  ).slice(0, 12)}`;
  const runDir = join(retentionDir, runId);
  const indexPath = join(retentionDir, 'index.json');
  const retentionLimit = resolveReadinessArtifactRetentionLimit(env);
  return withFileLockSync(join(retentionDir, '.artifact.lock'), () => {
    mkdirSync(retentionDir, { recursive: true });
    const indexState = readReadinessIndexState(indexPath);
    const retainedHistory = validateAndRecoverIndexedRunDirectories(
      retentionDir,
      indexState.currentRuns,
    );
    removeManagedTransactionResidueSync(retentionDir, runId);
    const stagingDir = uniqueManagedPath(retentionDir, runId, 'staging');
    mkdirSync(stagingDir, { recursive: true });
    try {
      const reportWithTraceArtifacts = writeE2ERedactedTraceArtifacts(report, stagingDir, runId);
      atomicWriteFileSync(
        join(stagingDir, 'report.json'),
        JSON.stringify(reportWithTraceArtifacts, null, 2),
        'utf8',
      );
      atomicWriteFileSync(
        join(stagingDir, 'dashboard.json'),
        JSON.stringify(reportWithTraceArtifacts.readinessDashboard, null, 2),
        'utf8',
      );
      const manifestContent = JSON.stringify(
        buildRetainedRunManifest(stagingDir, runId, report.generatedAt),
        null,
        2,
      );
      atomicWriteFileSync(join(stagingDir, RETAINED_RUN_MANIFEST_FILE), manifestContent, 'utf8');
      const manifestSha256 = sha256(manifestContent);
      replaceDirectoryFromStagingSync(stagingDir, runDir);

      const withoutDuplicate = retainedHistory.currentRuns.filter(
        (previousRun) => previousRun.runId !== runId,
      );
      const runs: E2EReadinessArtifactIndexEntry[] = [
        {
          runId,
          generatedAt: report.generatedAt,
          gitSha: report.runMetadata.gitSha,
          provider: report.runMetadata.provider,
          model: report.runMetadata.model,
          manifestRelativePath: `${runId}/${RETAINED_RUN_MANIFEST_FILE}`,
          manifestSha256,
          reportRelativePath: `${runId}/report.json`,
          dashboardRelativePath: `${runId}/dashboard.json`,
          passing: report.readinessDashboard.overall.passing,
          scenarioPassRate: report.readinessDashboard.overall.scenarioPassRate,
          pass1Rate: report.readinessDashboard.overall.pass1Rate,
        },
        ...withoutDuplicate,
      ];
      const retainedRuns = runs.slice(0, retentionLimit);
      const retainedRunIds = new Set(retainedRuns.map((run) => run.runId));
      atomicWriteFileSync(
        indexPath,
        JSON.stringify(
          {
            version: E2E_READINESS_DASHBOARD_VERSION,
            retainedRunCount: retainedRuns.length,
            retentionLimit,
            runs: retainedRuns,
          },
          null,
          2,
        ),
        'utf8',
      );
      for (const discardedRunId of [
        ...indexState.discardedRunIds,
        ...retainedHistory.discardedRunIds,
      ]) {
        if (!retainedRunIds.has(discardedRunId)) {
          rmSync(join(retentionDir, discardedRunId), { recursive: true, force: true });
        }
      }
      closeRetentionRoot(retentionDir, retainedRunIds);
      atomicWriteFileSync(
        dashboardPath,
        JSON.stringify(reportWithTraceArtifacts.readinessDashboard, null, 2),
        'utf8',
      );
      return { dashboardPath, runDir, indexPath, report: reportWithTraceArtifacts };
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  });
}
