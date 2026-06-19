#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { applyProjectLocalEnv, exitWithStatus, resolveProjectRoot } = require('./lib/harness');
const {
  buildProviderBatchSummary,
  buildSkippedProviderBatchSummary,
  resolveProviderCredentialStatus,
  summarizeMatrixReport,
} = require('./e2eReport/providerMatrix');
const {
  attachOnDeviceMatrixReport,
  buildMatrixRunPlanWithOnDeviceSelection,
  runOnDeviceBenchmarkForMatrix,
} = require('./e2eReport/onDeviceMatrix');

const label = 'e2e-provider-matrix';
const projectRoot = resolveProjectRoot();

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function formatRate(rate) {
  return Number(rate || 0).toFixed(3);
}

function runProviderBatch(run) {
  const env = {
    ...process.env,
    RUN_E2E_AGENT_EVAL: '1',
    E2E_PROVIDER: run.providerKey,
    E2E_SCENARIO_IDS: run.scenarioIds.join(','),
    E2E_REPORT_PATH: run.reportPath,
    E2E_MAX_SCENARIO_RETRIES: process.env.E2E_MAX_SCENARIO_RETRIES?.trim() || '0',
  };
  delete env.E2E_REPORT_PARTIAL_PATH;

  fs.mkdirSync(path.dirname(run.reportPath), { recursive: true });
  console.log(
    `[${label}] provider=${run.providerKey} batch=${run.batchId} scenarios=${run.scenarioIds.length} report=${run.reportPath}`,
  );

  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, 'scripts/e2e-assessment-collect.js')],
    {
      cwd: projectRoot,
      stdio: 'inherit',
      env,
    },
  );
  const exitStatus = result.status ?? 1;
  const report = readJsonFile(run.reportPath);
  const summary = buildProviderBatchSummary({
    ...run,
    exitStatus,
    report,
    reason: exitStatus === 0 ? undefined : 'assessment_collect_failed',
  });

  console.log(
    `[${label}] ${run.providerKey}/${run.batchId} ${summary.status} pass=${summary.passedCount}/${summary.scenarioCount} pass1=${formatRate(summary.pass1Rate)} cacheEligible=${formatRate(summary.eligibleCacheReadRate)} tokens=${summary.totalTokens}`,
  );
  if (summary.failedScenarioIds.length > 0) {
    console.log(`[${label}] failedScenarios=${summary.failedScenarioIds.join(',')}`);
  }
  return summary;
}

applyProjectLocalEnv(projectRoot);

let plan;
try {
  const matrixSelection = buildMatrixRunPlanWithOnDeviceSelection({
    projectRoot,
    env: process.env,
  });
  plan = matrixSelection.plan;
  plan.includeOnDevice = matrixSelection.includeOnDevice;
} catch (error) {
  console.error(`[${label}] ${error instanceof Error ? error.message : String(error)}`);
  exitWithStatus(1);
}

const allowMissing = process.env.E2E_PROVIDER_MATRIX_ALLOW_MISSING === '1';
const results = [];

for (const run of plan.runs) {
  const credentialStatus = resolveProviderCredentialStatus(run.providerKey, process.env);
  if (!credentialStatus.configured) {
    const reason = `missing ${credentialStatus.missing.join(', ')}`;
    if (!allowMissing) {
      console.error(`[${label}] provider=${run.providerKey} ${reason}`);
      exitWithStatus(1);
    }
    console.log(`[${label}] provider=${run.providerKey} batch=${run.batchId} skipped ${reason}`);
    results.push(buildSkippedProviderBatchSummary({ ...run, reason }));
    continue;
  }

  results.push(runProviderBatch(run));
}

let onDeviceSummary;
if (plan.includeOnDevice) {
  console.log(`[${label}] provider=on-device batch=on-device-benchmark report=${plan.reportDir}`);
  onDeviceSummary = runOnDeviceBenchmarkForMatrix({
    projectRoot,
    reportDir: plan.reportDir,
    env: process.env,
  });
  console.log(
    `[${label}] on-device ${onDeviceSummary.status} pass=${onDeviceSummary.passedCount}/${onDeviceSummary.scenarioCount} confidence=${onDeviceSummary.assessment?.confidenceLevel || 'n/a'}`,
  );
}

const matrixReport = attachOnDeviceMatrixReport(
  summarizeMatrixReport(plan, results),
  onDeviceSummary,
);
const matrixReportPath = path.join(plan.reportDir, 'matrix-report.json');
fs.mkdirSync(plan.reportDir, { recursive: true });
fs.writeFileSync(matrixReportPath, JSON.stringify(matrixReport, null, 2), 'utf8');

console.log(
  `[${label}] overall passing=${matrixReport.overall.passing} pass=${matrixReport.overall.passedCount}/${matrixReport.overall.scenarioCount} cacheEligible=${formatRate(matrixReport.overall.eligibleCacheReadRate)} tokens=${matrixReport.overall.totalTokens}`,
);
for (const providerSummary of matrixReport.providerSummaries) {
  console.log(
    `[${label}] provider=${providerSummary.providerKey} passing=${providerSummary.passing} pass=${providerSummary.passedCount}/${providerSummary.scenarioCount} cacheEligible=${formatRate(providerSummary.eligibleCacheReadRate)} tokens=${providerSummary.totalTokens}`,
  );
}
console.log(`[${label}] wrote ${matrixReportPath}`);

exitWithStatus(matrixReport.overall.passing ? 0 : 1);
