const {
  BENCHMARK_MANIFEST_VERSION,
  BENCHMARK_SOURCE_REFRESH_DATE,
  EXTERNAL_BENCHMARK_REQUIREMENTS,
  IMPLEMENTED_BENCHMARK_REQUIREMENT_COUNT,
  READINESS_ARTIFACT_RETENTION_RUNS,
  READINESS_DASHBOARD_VERSION,
} = require('./constants');
const { eligibleCacheReadTokens, safeRate } = require('./parser');
const { buildFailureTaxonomy, buildMinedEvalCandidates } = require('./taxonomy');

function percentile(values, percentileRank) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function buildFamilyReadiness(entries, assessment, reliability) {
  const reliabilityByScenario = new Map(
    reliability.scenarios.map((scenario) => [scenario.fixtureId, scenario]),
  );

  return assessment.benchmarkFamilies.map((family) => {
    const scenarioIds = new Set(family.scenarioIds);
    const familyEntries = entries.filter((entry) => scenarioIds.has(entry.fixtureId));
    const pass1Count = familyEntries.filter(
      (entry) => reliabilityByScenario.get(entry.fixtureId)?.passAt1,
    ).length;
    const passKCount = familyEntries.filter(
      (entry) => reliabilityByScenario.get(entry.fixtureId)?.passAtK,
    ).length;
    const eligibleInputTokens = familyEntries.reduce(
      (sum, entry) => sum + (entry.cache?.eligibleInputTokens ?? 0),
      0,
    );
    const eligibleReadTokens = familyEntries.reduce(
      (sum, entry) =>
        sum +
        eligibleCacheReadTokens(
          entry.cache?.cacheReadTokens ?? 0,
          entry.cache?.eligibleInputTokens ?? 0,
        ),
      0,
    );

    return {
      id: family.id,
      label: family.label,
      passRate: family.passRate,
      pass1Rate: safeRate(pass1Count, familyEntries.length),
      passKRate: safeRate(passKCount, familyEntries.length),
      p95DurationMs: percentile(
        familyEntries.map((entry) => entry.durationMs ?? 0),
        95,
      ),
      p95TotalTokens: percentile(
        familyEntries.map((entry) => entry.usage?.totalTokens ?? 0),
        95,
      ),
      cacheEligibleReadRate: safeRate(eligibleReadTokens, eligibleInputTokens),
      failedScenarioIds: [...family.failedScenarioIds],
    };
  });
}

function externalRequirementsBySource(sourceNeedles) {
  const normalizedNeedles = sourceNeedles.map((needle) => needle.toLowerCase());
  return EXTERNAL_BENCHMARK_REQUIREMENTS.filter((requirement) =>
    normalizedNeedles.some((needle) => requirement.source.toLowerCase().includes(needle)),
  )
    .map((requirement) => requirement.id)
    .sort();
}

function buildReadinessDashboard(params) {
  const mobileEntries = params.entries.filter((entry) =>
    (entry.assessmentDimensions ?? []).includes('mobile_native'),
  );
  const mobilePassedCount = mobileEntries.filter((entry) => entry.passed).length;
  const securityRequirementIds = externalRequirementsBySource(['agentdojo', 'mcptox']);

  return {
    version: READINESS_DASHBOARD_VERSION,
    generatedAt: params.generatedAt,
    sourceRefreshDate: BENCHMARK_SOURCE_REFRESH_DATE,
    benchmarkManifestVersion: BENCHMARK_MANIFEST_VERSION,
    runMetadata: {
      gitSha: params.runMetadata.gitSha,
      provider: params.runMetadata.provider,
      ...(params.runMetadata.providerId ? { providerId: params.runMetadata.providerId } : {}),
      model: params.runMetadata.model,
      ...(params.runMetadata.modelVersion ? { modelVersion: params.runMetadata.modelVersion } : {}),
      collectMode: params.runMetadata.collectMode,
    },
    overall: {
      passing: params.readiness.passing,
      failedCriteria: [...params.readiness.failedCriteria],
      scenarioPassRate: params.readiness.scenarioPassRate,
      pass1Rate: params.readiness.pass1Rate,
      passKRate: params.readiness.passKRate,
      evidenceScore: params.assessment.evidenceScore,
    },
    familyReadiness: buildFamilyReadiness(params.entries, params.assessment, params.reliability),
    reliability: {
      k: params.reliability.k,
      pass1Rate: params.reliability.pass1Rate,
      passKRate: params.reliability.passKRate,
      retriedScenarioCount: params.reliability.retriedScenarioCount,
    },
    tokenCostLatency: {
      inputTokens: params.totals.inputTokens,
      outputTokens: params.totals.outputTokens,
      totalTokens: params.totals.totalTokens,
      p95ScenarioTotalTokens: percentile(
        params.entries.map((entry) => entry.usage?.totalTokens ?? 0),
        95,
      ),
      p95ScenarioDurationMs: percentile(
        params.entries.map((entry) => entry.durationMs ?? 0),
        95,
      ),
      estimatedCostUsd: null,
      costStatus: 'provider_pricing_not_configured',
    },
    cache: {
      eligibleInputTokens: params.cache.eligibleInputTokens,
      eligibleCacheReadRate: params.cache.eligibleCacheReadRate,
      targetEligibleCacheReadRate: params.cache.targetEligibleCacheReadRate,
      cacheCreateFailureCount: params.cache.cacheCreateFailureCount,
      cacheCreateTelemetryAvailable: params.cache.cacheCreateTelemetryAvailable,
      passing: params.cache.passing,
    },
    mobileNative: {
      scenarioCount: mobileEntries.length,
      passedCount: mobilePassedCount,
      passRate: safeRate(mobilePassedCount, mobileEntries.length),
      externalRequirementIds: externalRequirementsBySource([
        'androidworld',
        'mobileagentbench',
        'simuwob',
      ]),
    },
    security: {
      benignUtilityRate: null,
      utilityUnderAttackRate: null,
      targetedAttackSuccessRate: null,
      status: securityRequirementIds.length > 0 ? 'external_required' : 'measured',
      externalRequirementIds: securityRequirementIds,
    },
    failureTaxonomy: buildFailureTaxonomy(params.entries, params.cache.targetEligibleCacheReadRate),
    minedEvalCandidates: buildMinedEvalCandidates(
      params.entries,
      params.cache.targetEligibleCacheReadRate,
    ),
    benchmarkRequirements: {
      implemented: IMPLEMENTED_BENCHMARK_REQUIREMENT_COUNT,
      externalRequired: EXTERNAL_BENCHMARK_REQUIREMENTS.length,
      externalRequirementIds: EXTERNAL_BENCHMARK_REQUIREMENTS.map((requirement) => requirement.id),
    },
    artifactRetention: {
      defaultRetainedRuns: READINESS_ARTIFACT_RETENTION_RUNS,
      artifactKinds: ['run_report', 'readiness_dashboard', 'stdout_stderr_log'],
    },
    refreshCadence: [
      {
        sourceGroup: 'provider_docs',
        cadenceDays: 30,
        lastReviewedAt: BENCHMARK_SOURCE_REFRESH_DATE,
      },
      {
        sourceGroup: 'bfcl_tau_agentdojo_security',
        cadenceDays: 90,
        lastReviewedAt: BENCHMARK_SOURCE_REFRESH_DATE,
      },
      {
        sourceGroup: 'mobile_benchmarks',
        cadenceDays: 90,
        lastReviewedAt: BENCHMARK_SOURCE_REFRESH_DATE,
      },
    ],
    humanAuditCalibration: {
      llmJudgeComponentCount:
        params.graderAudit.assistantProseRubricCount + params.graderAudit.weakPatternRubricCount,
      status:
        params.graderAudit.assistantProseRubricCount === 0 &&
        params.graderAudit.weakPatternRubricCount === 0
          ? 'not_required_structural_graders_only'
          : 'required',
    },
  };
}

module.exports = {
  percentile,
  buildFamilyReadiness,
  externalRequirementsBySource,
  buildReadinessDashboard,
  READINESS_DASHBOARD_VERSION,
};
