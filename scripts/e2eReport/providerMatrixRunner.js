const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { RUN_REPORT_SCHEMA_VERSION } = require('./constants');
const { buildProviderBatchSummary } = require('./providerMatrix');

function failedSummary(run, exitStatus, reason) {
  return buildProviderBatchSummary({
    ...run,
    exitStatus,
    report: undefined,
    reason,
  });
}

function runProviderBatchForMatrix(options) {
  const run = options.run;
  const canonicalReportPath = path.resolve(run.reportPath);
  const reportDir = path.dirname(canonicalReportPath);
  const invocationReportPath = path.join(
    reportDir,
    `.${path.basename(canonicalReportPath)}.${randomUUID()}.json`,
  );
  fs.mkdirSync(reportDir, { recursive: true });
  fs.rmSync(canonicalReportPath, { force: true });
  const env = {
    ...process.env,
    ...options.env,
    RUN_E2E_AGENT_EVAL: '1',
    E2E_PROVIDER: run.providerKey,
    E2E_SCENARIO_IDS: run.scenarioIds.join(','),
    E2E_REPORT_PATH: invocationReportPath,
    E2E_MAX_SCENARIO_RETRIES: options.env?.E2E_MAX_SCENARIO_RETRIES?.trim() || '0',
  };
  delete env.E2E_REPORT_PARTIAL_PATH;

  try {
    const result = spawnSync(
      process.execPath,
      [
        options.assessmentScriptPath ??
          path.join(options.projectRoot, 'scripts/e2e-assessment-collect.js'),
      ],
      {
        cwd: options.projectRoot,
        stdio: options.stdio ?? 'inherit',
        env,
      },
    );
    const exitStatus = result.status ?? 1;
    if (!fs.existsSync(invocationReportPath)) {
      return failedSummary(run, exitStatus, 'report_missing');
    }
    let report;
    try {
      report = JSON.parse(fs.readFileSync(invocationReportPath, 'utf8'));
    } catch {
      return failedSummary(run, exitStatus, 'report_invalid_json');
    }
    if (report?.schemaVersion !== RUN_REPORT_SCHEMA_VERSION) {
      return failedSummary(run, exitStatus, 'report_version_mismatch');
    }
    fs.renameSync(invocationReportPath, canonicalReportPath);
    return buildProviderBatchSummary({
      ...run,
      exitStatus,
      report,
      reason: exitStatus === 0 ? undefined : 'assessment_collect_failed',
    });
  } finally {
    fs.rmSync(invocationReportPath, { force: true });
  }
}

module.exports = { runProviderBatchForMatrix };
