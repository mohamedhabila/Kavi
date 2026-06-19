const {
  ASSESSMENT_MIN_DIMENSION_PASS_RATE,
  CRITICAL_READINESS_DIMENSIONS,
  READINESS_MIN_AXIS_PASS_RATE,
  READINESS_MIN_FAST_SUITE_SCENARIO_COUNT,
  READINESS_MIN_PASS_RATE,
} = require('./constants');
const { safeRate } = require('./parser');

function buildTotals(entries) {
  return entries.reduce(
    (acc, entry) => ({
      scenarioCount: acc.scenarioCount + 1,
      passedCount: acc.passedCount + (entry.passed ? 1 : 0),
      failedCount: acc.failedCount + (entry.passed ? 0 : 1),
      inputTokens: acc.inputTokens + (entry.usage?.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (entry.usage?.outputTokens ?? 0),
      cacheReadTokens: acc.cacheReadTokens + (entry.usage?.cacheReadTokens ?? 0),
      cacheWriteTokens: acc.cacheWriteTokens + (entry.usage?.cacheWriteTokens ?? 0),
      totalTokens: acc.totalTokens + (entry.usage?.totalTokens ?? 0),
      durationMs: acc.durationMs + (entry.durationMs ?? 0),
    }),
    {
      scenarioCount: 0,
      passedCount: 0,
      failedCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      durationMs: 0,
    },
  );
}

function buildGraderAudit(entries) {
  const missingRubricAuditScenarioIds = entries
    .filter((entry) => !entry.rubricAudit)
    .map((entry) => entry.fixtureId);
  const auditedEntries = entries.filter((entry) => entry.rubricAudit);
  const totals = auditedEntries.reduce(
    (acc, entry) => ({
      rubricCount: acc.rubricCount + (entry.rubricAudit?.rubricCount ?? 0),
      assistantProseRubricCount:
        acc.assistantProseRubricCount + (entry.rubricAudit?.assistantProseRubricCount ?? 0),
      weakPatternRubricCount:
        acc.weakPatternRubricCount + (entry.rubricAudit?.weakPatternRubricCount ?? 0),
      structuralSubstringRubricCount:
        acc.structuralSubstringRubricCount +
        (entry.rubricAudit?.structuralSubstringRubricCount ?? 0),
      risks: [...acc.risks, ...(entry.rubricAudit?.risks ?? [])],
    }),
    {
      rubricCount: 0,
      assistantProseRubricCount: 0,
      weakPatternRubricCount: 0,
      structuralSubstringRubricCount: 0,
      risks: [],
    },
  );

  return {
    scenarioCount: entries.length,
    auditedScenarioCount: auditedEntries.length,
    rubricCount: totals.rubricCount,
    assistantProseRubricCount: totals.assistantProseRubricCount,
    weakPatternRubricCount: totals.weakPatternRubricCount,
    structuralSubstringRubricCount: totals.structuralSubstringRubricCount,
    missingRubricAuditScenarioIds,
    risks: totals.risks,
    passing:
      missingRubricAuditScenarioIds.length === 0 &&
      totals.assistantProseRubricCount === 0 &&
      totals.weakPatternRubricCount === 0,
  };
}

function buildReliability(entries, maxScenarioRetries) {
  const k = Math.max(1, maxScenarioRetries + 1);
  const scenarios = entries.map((entry) => {
    const attemptCount = Math.max(1, entry.attemptCount ?? 1);
    return {
      fixtureId: entry.fixtureId,
      passed: Boolean(entry.passed),
      attemptCount,
      k,
      passAt1: Boolean(entry.passed) && attemptCount === 1,
      passAtK: Boolean(entry.passed) && attemptCount <= k,
      retriesUsed: Math.max(0, attemptCount - 1),
    };
  });
  const pass1PassedCount = scenarios.filter((scenario) => scenario.passAt1).length;
  const passKPassedCount = scenarios.filter((scenario) => scenario.passAtK).length;

  return {
    k,
    scenarioCount: scenarios.length,
    pass1PassedCount,
    passKPassedCount,
    pass1Rate: safeRate(pass1PassedCount, scenarios.length),
    passKRate: safeRate(passKPassedCount, scenarios.length),
    retriedScenarioCount: scenarios.filter((scenario) => scenario.retriesUsed > 0).length,
    scenarios,
  };
}

function groupAxisOutcomes(entries, axisKey) {
  const axisScenarioIds = new Map();

  for (const entry of entries) {
    const axes = Array.isArray(entry[axisKey]) ? entry[axisKey] : [];
    for (const axisId of axes) {
      if (!axisScenarioIds.has(axisId)) {
        axisScenarioIds.set(axisId, { scenarioIds: new Set(), failedScenarioIds: new Set() });
      }
      const bucket = axisScenarioIds.get(axisId);
      bucket.scenarioIds.add(entry.fixtureId);
      if (!entry.passed) {
        bucket.failedScenarioIds.add(entry.fixtureId);
      }
    }
  }

  return Array.from(axisScenarioIds.entries())
    .map(([axisId, bucket]) => {
      const scenarioIds = Array.from(bucket.scenarioIds).sort();
      const failedScenarioIds = Array.from(bucket.failedScenarioIds).sort();
      const total = scenarioIds.length;
      const passed = total - failedScenarioIds.length;
      const passRate = total > 0 ? passed / total : 0;
      return {
        id: axisId,
        label: axisId,
        passed,
        total,
        passRate,
        targetPassRate: ASSESSMENT_MIN_DIMENSION_PASS_RATE,
        passing: passRate >= ASSESSMENT_MIN_DIMENSION_PASS_RATE,
        scenarioIds,
        failedScenarioIds,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildAssessment(entries) {
  const scenarioCount = entries.length;
  const passedCount = entries.filter((entry) => entry.passed).length;
  const overallScenarioPassRate = scenarioCount > 0 ? passedCount / scenarioCount : 0;
  const dimensions = groupAxisOutcomes(entries, 'assessmentDimensions');
  const benchmarkFamilies = groupAxisOutcomes(entries, 'benchmarkFamilies');
  const rates = [...dimensions, ...benchmarkFamilies].map((summary) => summary.passRate);
  const evidenceScore =
    rates.length > 0
      ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length
      : overallScenarioPassRate;

  return {
    generatedAt: new Date().toISOString(),
    scenarioCount,
    overallScenarioPassRate,
    evidenceScore,
    dimensions,
    benchmarkFamilies,
    dimensionsPassing: dimensions.every((summary) => summary.passing),
    benchmarkFamiliesPassing: benchmarkFamilies.every((summary) => summary.passing),
  };
}

function buildReadiness(entries, assessment, cache, graderAudit, reliability) {
  const criticalFailedScenarioIds = entries
    .filter(
      (entry) =>
        !entry.passed &&
        Array.isArray(entry.assessmentDimensions) &&
        entry.assessmentDimensions.some((dimension) => CRITICAL_READINESS_DIMENSIONS.has(dimension)),
    )
    .map((entry) => entry.fixtureId)
    .sort();
  const failedCriteria = [];

  if (entries.length < READINESS_MIN_FAST_SUITE_SCENARIO_COUNT) {
    failedCriteria.push('scenario_coverage');
  }
  if (assessment.overallScenarioPassRate < READINESS_MIN_PASS_RATE) {
    failedCriteria.push('scenario_pass_rate');
  }
  if (reliability.pass1Rate < READINESS_MIN_PASS_RATE) {
    failedCriteria.push('pass1_reliability');
  }
  if (assessment.dimensions.length === 0 || assessment.benchmarkFamilies.length === 0) {
    failedCriteria.push('assessment_axis_coverage');
  }
  if (assessment.dimensions.some((dimension) => dimension.passRate < READINESS_MIN_AXIS_PASS_RATE)) {
    failedCriteria.push('dimension_pass_rates');
  }
  if (assessment.benchmarkFamilies.some((family) => family.passRate < READINESS_MIN_AXIS_PASS_RATE)) {
    failedCriteria.push('benchmark_family_pass_rates');
  }
  if (criticalFailedScenarioIds.length > 0) {
    failedCriteria.push('critical_dimension_failures');
  }
  if (!cache.passing) {
    failedCriteria.push('cache_readiness');
  }
  if (cache.eligibleInputTokens > 0 && !cache.cacheCreateTelemetryAvailable) {
    failedCriteria.push('cache_create_telemetry');
  }
  if (!graderAudit.passing) {
    failedCriteria.push('grader_audit');
  }

  return {
    passing: failedCriteria.length === 0,
    targetScenarioCount: READINESS_MIN_FAST_SUITE_SCENARIO_COUNT,
    targetScenarioPassRate: READINESS_MIN_PASS_RATE,
    targetAxisPassRate: READINESS_MIN_AXIS_PASS_RATE,
    scenarioPassRate: assessment.overallScenarioPassRate,
    pass1Rate: reliability.pass1Rate,
    passKRate: reliability.passKRate,
    cacheEligibleReadRate: cache.eligibleCacheReadRate,
    cachePassing: cache.passing,
    graderAuditPassing: graderAudit.passing,
    criticalFailureCount: criticalFailedScenarioIds.length,
    criticalFailedScenarioIds,
    failedCriteria,
  };
}

module.exports = {
  buildTotals,
  buildGraderAudit,
  buildReliability,
  groupAxisOutcomes,
  buildAssessment,
  buildReadiness,
};
