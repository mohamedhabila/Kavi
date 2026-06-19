const fs = require('fs');
const path = require('path');
const { buildOnDeviceAssessment } = require('./assessment');
const { ON_DEVICE_BENCHMARK_VERSION, REQUIRED_LIVE_METRIC_KEYS } = require('./constants');

function safeRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function isFiniteNumberOrNull(value) {
  return value === null || Number.isFinite(value);
}

function assertLiveMetricShape(scenario) {
  const metrics = scenario.metrics || {};
  const missingKeys = REQUIRED_LIVE_METRIC_KEYS.filter((key) => !(key in metrics));
  if (missingKeys.length > 0) {
    throw new Error(`Scenario ${scenario.id} is missing metric keys: ${missingKeys.join(', ')}`);
  }

  const numericKeys = [
    'engineInitMs',
    'ttftMs',
    'decodeTokensPerSecond',
    'outputTokens',
    'backendFallbackCount',
    'conversationCacheHits',
    'conversationCacheMisses',
    'memoryBeforeMb',
    'memoryAfterMb',
    'contextWindowTokens',
    'inputTokens',
    'inputBudgetTokens',
    'contextPressureRatio',
  ];
  const booleanKeys = [
    'nativeCrashed',
    'constrainedDecodingEnabled',
    'speculativeDecodingSupported',
    'speculativeDecodingEnabled',
    'capabilityCheckFailed',
  ];
  for (const key of numericKeys) {
    if (!isFiniteNumberOrNull(metrics[key])) {
      throw new Error(`Scenario ${scenario.id} metric ${key} must be a finite number or null.`);
    }
  }
  for (const key of booleanKeys) {
    if (metrics[key] !== true && metrics[key] !== false && metrics[key] !== null) {
      throw new Error(`Scenario ${scenario.id} metric ${key} must be a boolean or null.`);
    }
  }
  if (
    typeof metrics.contextCompactionState !== 'string' &&
    metrics.contextCompactionState !== null
  ) {
    throw new Error(
      `Scenario ${scenario.id} metric contextCompactionState must be a string or null.`,
    );
  }
}

function normalizeScenarioResult(scenario, plannedScenarioIds) {
  if (!plannedScenarioIds.has(scenario.id)) {
    throw new Error(`Driver returned unknown on-device scenario: ${scenario.id}`);
  }
  if (!['passed', 'failed', 'skipped'].includes(scenario.status)) {
    throw new Error(`Scenario ${scenario.id} has invalid status: ${scenario.status}`);
  }

  if (scenario.status !== 'skipped') {
    assertLiveMetricShape(scenario);
  }

  return {
    id: scenario.id,
    status: scenario.status,
    durationMs: Number.isFinite(scenario.durationMs) ? scenario.durationMs : null,
    metrics: scenario.metrics || {},
    error: scenario.error || null,
  };
}

function summarizeScenarioResults(scenarios, requiredScenarioIds) {
  const passedCount = scenarios.filter((scenario) => scenario.status === 'passed').length;
  const failedCount = scenarios.filter((scenario) => scenario.status === 'failed').length;
  const skippedCount = scenarios.filter((scenario) => scenario.status === 'skipped').length;
  const missingRequiredScenarioIds = Array.from(requiredScenarioIds).filter(
    (scenarioId) => !scenarios.some((scenario) => scenario.id === scenarioId),
  );
  const failedRequiredScenarioIds = scenarios
    .filter((scenario) => requiredScenarioIds.has(scenario.id) && scenario.status !== 'passed')
    .map((scenario) => scenario.id)
    .sort();
  const nativeCrashCount = scenarios.filter(
    (scenario) => scenario.metrics?.nativeCrashed === true,
  ).length;

  return {
    scenarioCount: scenarios.length,
    passedCount,
    failedCount,
    skippedCount,
    passRate: safeRate(passedCount, scenarios.length),
    failedRequiredScenarioIds,
    missingRequiredScenarioIds,
    nativeCrashCount,
    crashFree: nativeCrashCount === 0,
    passing:
      missingRequiredScenarioIds.length === 0 &&
      failedRequiredScenarioIds.length === 0 &&
      failedCount === 0,
  };
}

function buildSkippedReport(config, reason, detail) {
  const summary = {
    scenarioCount: 0,
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    passRate: 0,
    failedRequiredScenarioIds: [],
    missingRequiredScenarioIds: [],
    nativeCrashCount: 0,
    crashFree: true,
    passing: false,
  };
  return {
    version: ON_DEVICE_BENCHMARK_VERSION,
    generatedAt: config.generatedAt,
    status: 'skipped',
    reason,
    detail: detail || null,
    platform: config.platform,
    app: {
      appId: config.appId,
    },
    device: {
      deviceId: config.device.deviceId || null,
    },
    model: {
      modelId: config.modelId || null,
      modelPath: config.modelPath || null,
      runtime: config.runtime,
      backend: config.backend || null,
      capabilities: {
        tools: config.modelCapabilities?.tools === true,
      },
    },
    scenarios: [],
    summary,
    assessment: buildOnDeviceAssessment(config, [], summary),
  };
}

function buildFailedReport(config, reason, detail) {
  const baseReport = buildSkippedReport(config, reason, detail);
  return {
    ...baseReport,
    status: 'failed',
    summary: {
      ...baseReport.summary,
      passing: false,
    },
  };
}

function buildCompletedReport(config, plan, driverReport) {
  const plannedScenarioIds = new Set(plan.scenarios.map((scenario) => scenario.id));
  const requiredScenarioIds = new Set(
    plan.scenarios.filter((scenario) => scenario.required).map((scenario) => scenario.id),
  );
  const scenarios = (driverReport.scenarios || []).map((scenario) =>
    normalizeScenarioResult(scenario, plannedScenarioIds),
  );
  const summary = summarizeScenarioResults(scenarios, requiredScenarioIds);

  return {
    version: ON_DEVICE_BENCHMARK_VERSION,
    generatedAt: new Date().toISOString(),
    status: summary.passing ? 'passed' : 'failed',
    platform: plan.platform,
    app: plan.app,
    device: {
      ...plan.device,
      ...(driverReport.device || {}),
    },
    model: {
      ...plan.model,
      ...(driverReport.model || {}),
    },
    defaults: plan.defaults,
    scenarios,
    summary,
    assessment: buildOnDeviceAssessment(config, scenarios, summary),
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

module.exports = {
  buildCompletedReport,
  buildFailedReport,
  buildSkippedReport,
  normalizeScenarioResult,
  summarizeScenarioResults,
  writeJson,
};
