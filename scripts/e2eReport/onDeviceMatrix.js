const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  PROVIDER_MATRIX_VERSION,
  buildMatrixRunPlan,
  parseCsvEnv,
  resolveBatchSelection,
  resolveMatrixReportDir,
  resolveMatrixRunId,
} = require('./providerMatrix');

const ON_DEVICE_PROVIDER_KEY = 'on-device';
const ON_DEVICE_PROVIDER_ALIASES = new Set([
  ON_DEVICE_PROVIDER_KEY,
  'ondevice',
  'local',
  'local-llm',
]);

function splitProviderSelection(env) {
  const rawValue = env.E2E_PROVIDER_MATRIX_PROVIDERS || env.E2E_PROVIDER_MATRIX;
  const requested = parseCsvEnv(rawValue);
  if (requested.length === 0) {
    return {
      explicit: false,
      includeOnDevice: env.E2E_PROVIDER_MATRIX_INCLUDE_ON_DEVICE === '1',
      cloudProviders: [],
    };
  }

  const cloudProviders = [];
  let includeOnDevice = false;
  for (const provider of requested) {
    if (ON_DEVICE_PROVIDER_ALIASES.has(provider.toLowerCase())) {
      includeOnDevice = true;
    } else {
      cloudProviders.push(provider);
    }
  }

  return {
    explicit: true,
    includeOnDevice,
    cloudProviders,
  };
}

function buildMatrixRunPlanWithOnDeviceSelection(options) {
  const projectRoot = options.projectRoot;
  const env = options.env || process.env;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const selection = splitProviderSelection(env);

  if (!selection.explicit || selection.cloudProviders.length > 0) {
    const matrixEnv = { ...env };
    if (selection.explicit) {
      matrixEnv.E2E_PROVIDER_MATRIX_PROVIDERS = selection.cloudProviders.join(',');
      delete matrixEnv.E2E_PROVIDER_MATRIX;
    }
    return {
      plan: buildMatrixRunPlan({ projectRoot, env: matrixEnv, generatedAt }),
      includeOnDevice: selection.includeOnDevice,
    };
  }

  const runId = resolveMatrixRunId(env, generatedAt);
  const reportDir = resolveMatrixReportDir(projectRoot, env, runId);
  const batches = resolveBatchSelection(env);
  return {
    plan: {
      version: PROVIDER_MATRIX_VERSION,
      generatedAt,
      runId,
      reportDir,
      providerKeys: [],
      batches: batches.map((batch) => ({
        id: batch.id,
        label: batch.label,
        description: batch.description,
        scenarioIds: [...batch.scenarioIds],
      })),
      runs: [],
    },
    includeOnDevice: true,
  };
}

function runOnDeviceBenchmarkForMatrix(options) {
  const reportPath = path.join(options.reportDir, 'on-device-benchmark.json');
  const env = {
    ...process.env,
    ...options.env,
    E2E_ON_DEVICE_REPORT_PATH: reportPath,
  };
  const result = spawnSync(
    process.execPath,
    [path.join(options.projectRoot, 'scripts/on-device-benchmark.js')],
    {
      cwd: options.projectRoot,
      stdio: 'inherit',
      env,
    },
  );
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
  return buildOnDeviceMatrixSummary({
    report,
    reportPath,
    exitStatus: result.status ?? 1,
  });
}

function buildOnDeviceMatrixSummary(params) {
  const report = params.report;
  if (!report) {
    return failedOnDeviceMatrixSummary(params.reportPath, 'report_missing', params.exitStatus);
  }

  const summary = report.summary || {};
  const status =
    report.status === 'passed' ? 'passed' : report.status === 'skipped' ? 'skipped' : 'failed';
  const scenarioCount = summary.scenarioCount ?? 0;
  const passedCount = summary.passedCount ?? 0;
  const failedCount = summary.failedCount ?? 0;
  const skippedCount = summary.skippedCount ?? 0;

  return {
    providerKey: ON_DEVICE_PROVIDER_KEY,
    provider: ON_DEVICE_PROVIDER_KEY,
    model: report.model?.modelId || null,
    batchId: 'on-device-benchmark',
    reportPath: params.reportPath,
    status,
    exitStatus: params.exitStatus,
    metricsPassing: status === 'passed',
    passing: status === 'passed',
    reason: report.reason || null,
    scenarioCount,
    passedCount,
    failedCount,
    skippedCount,
    passRate: summary.passRate ?? safeRate(passedCount, scenarioCount),
    pass1Rate: summary.passRate ?? safeRate(passedCount, scenarioCount),
    cacheReadRate: 0,
    eligibleCacheReadRate: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    failedScenarioIds: [
      ...(summary.failedRequiredScenarioIds || []),
      ...(summary.missingRequiredScenarioIds || []),
    ].sort(),
    assessment: report.assessment || null,
    benchmarkSummary: summary,
  };
}

function failedOnDeviceMatrixSummary(reportPath, reason, exitStatus) {
  return {
    providerKey: ON_DEVICE_PROVIDER_KEY,
    provider: ON_DEVICE_PROVIDER_KEY,
    model: null,
    batchId: 'on-device-benchmark',
    reportPath,
    status: 'failed',
    exitStatus,
    metricsPassing: false,
    passing: false,
    reason,
    scenarioCount: 0,
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    passRate: 0,
    pass1Rate: 0,
    cacheReadRate: 0,
    eligibleCacheReadRate: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    failedScenarioIds: [],
    assessment: null,
    benchmarkSummary: null,
  };
}

function attachOnDeviceMatrixReport(matrixReport, onDeviceSummary) {
  if (!onDeviceSummary) {
    return matrixReport;
  }

  const providerSummaries = [...matrixReport.providerSummaries, onDeviceSummary].sort(
    (left, right) => left.providerKey.localeCompare(right.providerKey),
  );
  const blocksOverall = onDeviceSummary.status === 'failed';
  const hasCloudProviders = matrixReport.providerKeys.length > 0;
  const cloudPassing = hasCloudProviders ? matrixReport.overall.passing : true;
  const onDevicePassing = onDeviceSummary.status === 'passed';
  const onDeviceSkippedWithoutCloud = !hasCloudProviders && onDeviceSummary.status === 'skipped';
  const scenarioCount = matrixReport.overall.scenarioCount + onDeviceSummary.scenarioCount;
  const passedCount = matrixReport.overall.passedCount + onDeviceSummary.passedCount;
  const failedCount = matrixReport.overall.failedCount + onDeviceSummary.failedCount;
  return {
    ...matrixReport,
    providerSummaries,
    onDevice: onDeviceSummary,
    overall: {
      ...matrixReport.overall,
      batchRunCount: matrixReport.overall.batchRunCount + 1,
      failedBatchRunCount: matrixReport.overall.failedBatchRunCount + (blocksOverall ? 1 : 0),
      skippedBatchRunCount:
        matrixReport.overall.skippedBatchRunCount + (onDeviceSummary.status === 'skipped' ? 1 : 0),
      scenarioCount,
      passedCount,
      failedCount,
      passRate: safeRate(passedCount, scenarioCount),
      passing:
        cloudPassing &&
        !blocksOverall &&
        (onDevicePassing || (!onDeviceSkippedWithoutCloud && onDeviceSummary.status === 'skipped')),
      onDeviceStatus: onDeviceSummary.status,
      onDeviceConfidenceLevel: onDeviceSummary.assessment?.confidenceLevel || null,
    },
  };
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

module.exports = {
  ON_DEVICE_PROVIDER_KEY,
  attachOnDeviceMatrixReport,
  buildMatrixRunPlanWithOnDeviceSelection,
  buildOnDeviceMatrixSummary,
  runOnDeviceBenchmarkForMatrix,
  splitProviderSelection,
};
