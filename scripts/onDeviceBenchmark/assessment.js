function numericMetric(scenario, key) {
  const value = scenario.metrics?.[key];
  return Number.isFinite(value) ? value : null;
}

function averageMetric(scenarios, key) {
  const values = scenarios
    .map((scenario) => numericMetric(scenario, key))
    .filter((value) => value !== null);
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function firstMetric(scenarios, key) {
  return (
    scenarios
      .map((scenario) => scenario.metrics?.[key])
      .find((value) => value !== undefined && value !== null) ?? null
  );
}

function buildMeasuredMetrics(scenarios, summary) {
  const executedScenarios = scenarios.filter((scenario) => scenario.status !== 'skipped');
  return {
    engineInitMs: averageMetric(executedScenarios, 'engineInitMs'),
    ttftMs: averageMetric(executedScenarios, 'ttftMs'),
    decodeTokensPerSecond: averageMetric(executedScenarios, 'decodeTokensPerSecond'),
    crashFreeRunRate:
      executedScenarios.length > 0 ? 1 - summary.nativeCrashCount / executedScenarios.length : null,
    activeBackend: firstMetric(executedScenarios, 'activeBackend'),
    contextWindowTokens: firstMetric(executedScenarios, 'contextWindowTokens'),
  };
}

function buildGalleryComparison(measured, galleryBaseline) {
  const galleryMetrics = galleryBaseline?.metrics || null;
  if (!galleryMetrics) {
    return {
      status: 'missing_baseline',
      metrics: measured,
      galleryMetrics: null,
      ratios: {},
    };
  }

  return {
    status: 'compared',
    metrics: measured,
    galleryMetrics,
    ratios: {
      engineInitMs: ratio(measured.engineInitMs, galleryMetrics.engineInitMs),
      ttftMs: ratio(measured.ttftMs, galleryMetrics.ttftMs),
      decodeTokensPerSecond: ratio(
        measured.decodeTokensPerSecond,
        galleryMetrics.decodeTokensPerSecond,
      ),
      crashFreeRunRate: ratio(measured.crashFreeRunRate, galleryMetrics.crashFreeRunRate),
      contextWindowTokens: ratio(measured.contextWindowTokens, galleryMetrics.contextWindowTokens),
    },
  };
}

function ratio(value, baseline) {
  if (!Number.isFinite(value) || !Number.isFinite(baseline) || baseline === 0) {
    return null;
  }
  return value / baseline;
}

function hasLimitedIosLifecycleCoverage(config, scenarios) {
  if (config.platform !== 'ios') {
    return false;
  }
  const lifecycleScenario = scenarios.find(
    (scenario) => scenario.id === 'background-foreground-interruption',
  );
  return (
    lifecycleScenario?.status === 'passed' &&
    lifecycleScenario.metrics?.lifecycleInterruptionMode !== 'app-background-foreground'
  );
}

function buildMissingCoverage(config, scenarios, summary, galleryComparison) {
  const missingCoverage = [];
  if (galleryComparison.status !== 'compared') {
    missingCoverage.push('gallery_same_device_baseline');
  }
  if (config.modelCapabilities?.tools !== true) {
    missingCoverage.push('tool_capable_local_model');
  }
  if (hasLimitedIosLifecycleCoverage(config, scenarios)) {
    missingCoverage.push('ios_true_background_foreground_lifecycle');
  }
  missingCoverage.push(...summary.missingRequiredScenarioIds);
  missingCoverage.push(...summary.failedRequiredScenarioIds);
  return Array.from(new Set(missingCoverage)).sort();
}

function resolveConfidence(summary, missingCoverage) {
  if (!summary.passing) {
    return 'low';
  }
  if (missingCoverage.length === 0) {
    return 'high';
  }
  return 'medium';
}

function buildOnDeviceAssessment(config, scenarios, summary) {
  const measuredMetrics = buildMeasuredMetrics(scenarios, summary);
  const galleryComparison = buildGalleryComparison(measuredMetrics, config.galleryBaseline);
  const missingCoverage = buildMissingCoverage(config, scenarios, summary, galleryComparison);
  return {
    confidenceLevel: resolveConfidence(summary, missingCoverage),
    missingCoverage,
    galleryComparison,
  };
}

module.exports = {
  buildGalleryComparison,
  buildMeasuredMetrics,
  buildOnDeviceAssessment,
};
