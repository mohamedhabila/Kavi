const fs = require('fs');
const path = require('path');
const { READINESS_ARTIFACT_RETENTION_RUNS, READINESS_DASHBOARD_VERSION } = require('./constants');
const { parseOptionalStrictPositiveInteger } = require('./configParsing');
const {
  atomicWriteFileSync,
  removeManagedTransactionResidueSync,
  replaceDirectoryFromStagingSync,
  uniqueManagedPath,
  withFileLockSync,
} = require('./fileTransaction');
const { writeRedactedTraceArtifacts } = require('./publicTraceArtifacts');
const { writeE2eReportSummaryArtifact } = require('./summary');

function resolveReadinessRetentionLimit() {
  return (
    parseOptionalStrictPositiveInteger(
      process.env.E2E_READINESS_ARTIFACT_RETENTION_LIMIT,
      'E2E readiness artifact retention limit',
    ) ?? READINESS_ARTIFACT_RETENTION_RUNS
  );
}

function sanitizeRunIdPart(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_.-]+/g, '-');
}

function isSafeRunId(value) {
  return (
    typeof value === 'string' &&
    value !== '.' &&
    value !== '..' &&
    value.length > 0 &&
    sanitizeRunIdPart(value) === value
  );
}

function normalizeCurrentReadinessIndexEntry(entry) {
  if (
    !entry ||
    !isSafeRunId(entry.runId) ||
    entry.reportRelativePath !== `${entry.runId}/report.json` ||
    entry.dashboardRelativePath !== `${entry.runId}/dashboard.json` ||
    typeof entry.generatedAt !== 'string' ||
    typeof entry.gitSha !== 'string' ||
    typeof entry.provider !== 'string' ||
    typeof entry.model !== 'string' ||
    typeof entry.passing !== 'boolean' ||
    !Number.isFinite(entry.scenarioPassRate) ||
    !Number.isFinite(entry.pass1Rate)
  ) {
    return undefined;
  }
  return {
    runId: entry.runId,
    generatedAt: entry.generatedAt,
    gitSha: entry.gitSha,
    provider: entry.provider,
    model: entry.model,
    reportRelativePath: entry.reportRelativePath,
    dashboardRelativePath: entry.dashboardRelativePath,
    passing: entry.passing,
    scenarioPassRate: entry.scenarioPassRate,
    pass1Rate: entry.pass1Rate,
  };
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readReadinessIndexState(indexPath) {
  const index = readJsonFile(indexPath, {
    version: READINESS_DASHBOARD_VERSION,
    runs: [],
  });
  if (!index || typeof index !== 'object' || !Array.isArray(index.runs)) {
    throw new Error('E2E readiness index is malformed.');
  }
  if (index.version !== READINESS_DASHBOARD_VERSION) {
    return {
      currentRuns: [],
      discardedRunIds: index.runs.map((run) => run?.runId).filter((runId) => isSafeRunId(runId)),
    };
  }
  const currentRuns = index.runs.map(normalizeCurrentReadinessIndexEntry);
  if (currentRuns.some((run) => !run)) {
    throw new Error('E2E readiness index contains an invalid current-schema run.');
  }
  const runIds = currentRuns.map((run) => run.runId);
  if (new Set(runIds).size !== runIds.length) {
    throw new Error('E2E readiness index contains duplicate run ids.');
  }
  return { currentRuns, discardedRunIds: [] };
}

function writeReadinessArtifacts(resolvedReportPath, report) {
  const dashboardPath = `${resolvedReportPath}.dashboard.json`;
  const retentionDir = path.resolve(
    process.env.E2E_READINESS_ARTIFACT_RETENTION_DIR?.trim() ||
      path.join(path.dirname(resolvedReportPath), 'e2e-readiness-runs'),
  );
  const runId = `run-${sanitizeRunIdPart(report.generatedAt)}-${sanitizeRunIdPart(
    report.runMetadata.gitSha,
  ).slice(0, 12)}`;
  const runDir = path.join(retentionDir, runId);
  const indexPath = path.join(retentionDir, 'index.json');
  const retainLimit = resolveReadinessRetentionLimit();
  return withFileLockSync(path.join(retentionDir, '.artifact.lock'), () => {
    fs.mkdirSync(retentionDir, { recursive: true });
    const indexState = readReadinessIndexState(indexPath);
    removeManagedTransactionResidueSync(retentionDir, runId);
    const stagingDir = uniqueManagedPath(retentionDir, runId, 'staging');
    fs.mkdirSync(stagingDir, { recursive: true });
    try {
      const publicReport = writeRedactedTraceArtifacts(report, stagingDir, runId);
      atomicWriteFileSync(
        path.join(stagingDir, 'report.json'),
        JSON.stringify(publicReport, null, 2),
        'utf8',
      );
      atomicWriteFileSync(
        path.join(stagingDir, 'dashboard.json'),
        JSON.stringify(publicReport.readinessDashboard, null, 2),
        'utf8',
      );
      replaceDirectoryFromStagingSync(stagingDir, runDir);

      const withoutDuplicate = indexState.currentRuns.filter(
        (previousRun) => previousRun.runId !== runId,
      );
      const runs = [
        {
          runId,
          generatedAt: report.generatedAt,
          gitSha: report.runMetadata.gitSha,
          provider: report.runMetadata.provider,
          model: report.runMetadata.model,
          reportRelativePath: `${runId}/report.json`,
          dashboardRelativePath: `${runId}/dashboard.json`,
          passing: report.readinessDashboard.overall.passing,
          scenarioPassRate: report.readinessDashboard.overall.scenarioPassRate,
          pass1Rate: report.readinessDashboard.overall.pass1Rate,
        },
        ...withoutDuplicate,
      ];

      const retainedRuns = runs.slice(0, retainLimit);
      const retainedRunIds = new Set(retainedRuns.map((run) => run.runId));
      atomicWriteFileSync(
        indexPath,
        JSON.stringify(
          {
            version: READINESS_DASHBOARD_VERSION,
            retainedRunCount: retainedRuns.length,
            retentionLimit: retainLimit,
            runs: retainedRuns,
          },
          null,
          2,
        ),
        'utf8',
      );
      for (const run of runs.slice(retainedRuns.length)) {
        fs.rmSync(path.join(retentionDir, run.runId), { recursive: true, force: true });
      }
      for (const discardedRunId of indexState.discardedRunIds) {
        fs.rmSync(path.join(retentionDir, discardedRunId), { recursive: true, force: true });
      }
      for (const candidate of fs.readdirSync(retentionDir)) {
        if (candidate.startsWith('run-') && !retainedRunIds.has(candidate)) {
          fs.rmSync(path.join(retentionDir, candidate), { recursive: true, force: true });
        }
      }
      atomicWriteFileSync(
        dashboardPath,
        JSON.stringify(publicReport.readinessDashboard, null, 2),
        'utf8',
      );
      return { dashboardPath, runDir, indexPath, report: publicReport };
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  });
}

function writeReportArtifacts(reportPath, partialPath, report) {
  const resolvedReportPath = path.resolve(reportPath);
  fs.mkdirSync(path.dirname(resolvedReportPath), { recursive: true });
  const readinessArtifacts = writeReadinessArtifacts(resolvedReportPath, report);
  atomicWriteFileSync(
    resolvedReportPath,
    JSON.stringify(readinessArtifacts.report, null, 2),
    'utf8',
  );
  const summaryPath = writeE2eReportSummaryArtifact(resolvedReportPath, readinessArtifacts.report);

  if (fs.existsSync(partialPath)) {
    fs.unlinkSync(partialPath);
  }

  return { resolvedReportPath, readinessArtifacts, summaryPath, report: readinessArtifacts.report };
}

module.exports = {
  resolveReadinessRetentionLimit,
  sanitizeRunIdPart,
  isSafeRunId,
  normalizeCurrentReadinessIndexEntry,
  readJsonFile,
  readReadinessIndexState,
  writeReadinessArtifacts,
  writeReportArtifacts,
};
