const fs = require('fs');
const path = require('path');
const { READINESS_ARTIFACT_RETENTION_RUNS, READINESS_DASHBOARD_VERSION } = require('./constants');
const { parseNonNegativeInteger } = require('./parser');
const { writeE2eReportSummaryArtifact } = require('./summary');

function resolveReadinessRetentionLimit() {
  return (
    parseNonNegativeInteger(process.env.E2E_READINESS_ARTIFACT_RETENTION_LIMIT) ??
    READINESS_ARTIFACT_RETENTION_RUNS
  );
}

function sanitizeRunIdPart(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_.-]+/g, '-');
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeReadinessArtifacts(resolvedReportPath, report) {
  const dashboardPath = `${resolvedReportPath}.dashboard.json`;
  fs.writeFileSync(dashboardPath, JSON.stringify(report.readinessDashboard, null, 2), 'utf8');

  const retentionDir = path.resolve(
    process.env.E2E_READINESS_ARTIFACT_RETENTION_DIR?.trim() ||
      path.join(path.dirname(resolvedReportPath), 'e2e-readiness-runs'),
  );
  const runId = `${sanitizeRunIdPart(report.generatedAt)}-${sanitizeRunIdPart(
    report.runMetadata.gitSha,
  ).slice(0, 12)}`;
  const runDir = path.join(retentionDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    path.join(runDir, 'dashboard.json'),
    JSON.stringify(report.readinessDashboard, null, 2),
    'utf8',
  );

  const indexPath = path.join(retentionDir, 'index.json');
  const previousIndex = readJsonFile(indexPath, { runs: [] });
  const withoutDuplicate = Array.isArray(previousIndex.runs)
    ? previousIndex.runs.filter((run) => run.runId !== runId)
    : [];
  const runs = [
    {
      runId,
      generatedAt: report.generatedAt,
      gitSha: report.runMetadata.gitSha,
      provider: report.runMetadata.provider,
      model: report.runMetadata.model,
      reportPath: path.join(runDir, 'report.json'),
      dashboardPath: path.join(runDir, 'dashboard.json'),
      passing: report.readinessDashboard.overall.passing,
      scenarioPassRate: report.readinessDashboard.overall.scenarioPassRate,
      pass1Rate: report.readinessDashboard.overall.pass1Rate,
    },
    ...withoutDuplicate,
  ].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));

  const retainLimit = resolveReadinessRetentionLimit();
  const retainedRuns = runs.slice(0, retainLimit);
  const prunedRuns = runs.slice(retainLimit);
  for (const run of prunedRuns) {
    if (run.runId) {
      fs.rmSync(path.join(retentionDir, run.runId), { recursive: true, force: true });
    }
  }
  fs.mkdirSync(retentionDir, { recursive: true });
  fs.writeFileSync(
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

  return { dashboardPath, runDir, indexPath };
}

function writeReportArtifacts(reportPath, partialPath, report) {
  const resolvedReportPath = path.resolve(reportPath);
  fs.mkdirSync(path.dirname(resolvedReportPath), { recursive: true });
  fs.writeFileSync(resolvedReportPath, JSON.stringify(report, null, 2), 'utf8');
  const readinessArtifacts = writeReadinessArtifacts(resolvedReportPath, report);
  const summaryPath = writeE2eReportSummaryArtifact(resolvedReportPath, report);

  if (fs.existsSync(partialPath)) {
    fs.unlinkSync(partialPath);
  }

  return { resolvedReportPath, readinessArtifacts, summaryPath };
}

module.exports = {
  resolveReadinessRetentionLimit,
  sanitizeRunIdPart,
  readJsonFile,
  writeReadinessArtifacts,
  writeReportArtifacts,
};
