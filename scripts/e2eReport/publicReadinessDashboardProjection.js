const { hashPrivateString, safePublicToolName } = require('./publicTraceSchema');
const {
  ASSESSMENT_DIMENSIONS,
  BENCHMARK_FAMILY_PUBLIC_META,
  BENCHMARK_FAMILIES,
  FAILURE_CATEGORIES,
  GRAPH_STATUSES,
  isPublicEvaluationId,
  MAX_PUBLIC_ITEMS,
  READINESS_CRITERIA,
  RUBRIC_KINDS,
} = require('./publicProjectionPolicy');

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function finiteNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function boundedString(value, fallback = 'unknown', maxLength = 512) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : fallback;
}

function publicStringArray(value, allowedValues, maxItems = MAX_PUBLIC_ITEMS) {
  if (!Array.isArray(value)) {
    return [];
  }
  const strings = value
    .filter((entry) => typeof entry === 'string' && entry.length <= 512)
    .filter((entry) => !allowedValues || allowedValues.has(entry))
    .slice(0, maxItems);
  return Array.from(new Set(strings)).sort((left, right) => left.localeCompare(right));
}

function projectNumericObject(value, keys) {
  const source = asRecord(value);
  return Object.fromEntries(keys.map((key) => [key, finiteNumber(source[key])]));
}

function publicEvaluationIdArray(value, fieldName, maxItems = MAX_PUBLIC_ITEMS) {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.some((entry) => !isPublicEvaluationId(entry))) {
    throw new Error(`Public E2E dashboard contains an invalid ${fieldName}.`);
  }
  return publicStringArray(value, undefined, maxItems);
}

function publicEvaluationId(value, fieldName) {
  if (!isPublicEvaluationId(value)) {
    throw new Error(`Public E2E dashboard contains an invalid ${fieldName}.`);
  }
  return value;
}

function projectFamilyReadiness(value) {
  const source = asRecord(value);
  const meta = BENCHMARK_FAMILY_PUBLIC_META[source.id];
  if (!meta) {
    throw new Error('Public E2E dashboard contains an invalid benchmark family.');
  }
  return {
    id: source.id,
    label: meta.label,
    ...projectNumericObject(source, [
      'passRate',
      'pass1Rate',
      'passKRate',
      'p95DurationMs',
      'p95TotalTokens',
      'cacheEligibleReadRate',
    ]),
    failedScenarioIds: publicEvaluationIdArray(
      source.failedScenarioIds,
      'family readiness scenario id',
    ),
  };
}

function projectFailureCluster(value) {
  const source = asRecord(value);
  return {
    category: FAILURE_CATEGORIES.has(source.category)
      ? source.category
      : 'unknown_structural_failure',
    count: finiteNumber(source.count),
    scenarioIds: publicEvaluationIdArray(source.scenarioIds, 'failure taxonomy scenario id'),
    failedRubricKinds: publicStringArray(source.failedRubricKinds, RUBRIC_KINDS),
    benchmarkFamilies: publicStringArray(source.benchmarkFamilies, BENCHMARK_FAMILIES),
    assessmentDimensions: publicStringArray(source.assessmentDimensions, ASSESSMENT_DIMENSIONS),
    externalRequirementIds: publicStringArray(source.externalRequirementIds),
  };
}

function projectMinedCandidate(value) {
  const source = asRecord(value);
  const rawToolNames = Array.isArray(source.toolCallNames)
    ? source.toolCallNames.filter((name) => typeof name === 'string').slice(0, MAX_PUBLIC_ITEMS)
    : [];
  const graphStatus = GRAPH_STATUSES.has(source.graphStatus) ? source.graphStatus : null;
  return {
    id: boundedString(source.id),
    sourceScenarioId: publicEvaluationId(source.sourceScenarioId, 'mined candidate scenario id'),
    traceFingerprintHash: hashPrivateString(source.traceFingerprint),
    categories: publicStringArray(source.categories, FAILURE_CATEGORIES),
    benchmarkFamilies: publicStringArray(source.benchmarkFamilies, BENCHMARK_FAMILIES),
    assessmentDimensions: publicStringArray(source.assessmentDimensions, ASSESSMENT_DIMENSIONS),
    failedRubricKinds: publicStringArray(source.failedRubricKinds, RUBRIC_KINDS),
    toolCallNames: publicStringArray(rawToolNames.map(safePublicToolName).filter(Boolean)),
    toolCallNameHashes: rawToolNames.map(hashPrivateString),
    graphStatus,
    privacy: {
      rawPromptIncluded: false,
      rawToolArgsIncluded: false,
      rawToolResultsIncluded: false,
      rawAssistantTextIncluded: false,
    },
  };
}

function projectReadinessDashboard(value, projectRunMetadata) {
  const source = asRecord(value);
  const overall = asRecord(source.overall);
  const reliability = asRecord(source.reliability);
  const tokenCostLatency = asRecord(source.tokenCostLatency);
  const cache = asRecord(source.cache);
  const mobileNative = asRecord(source.mobileNative);
  const security = asRecord(source.security);
  const benchmarkRequirements = asRecord(source.benchmarkRequirements);
  const artifactRetention = asRecord(source.artifactRetention);
  const humanAuditCalibration = asRecord(source.humanAuditCalibration);
  return {
    version: boundedString(source.version),
    generatedAt: boundedString(source.generatedAt),
    sourceRefreshDate: boundedString(source.sourceRefreshDate),
    benchmarkManifestVersion: boundedString(source.benchmarkManifestVersion),
    runMetadata: projectRunMetadata(source.runMetadata),
    overall: {
      passing: booleanValue(overall.passing),
      failedCriteria: publicStringArray(overall.failedCriteria, READINESS_CRITERIA),
      ...projectNumericObject(overall, [
        'scenarioPassRate',
        'pass1Rate',
        'passKRate',
        'evidenceScore',
      ]),
    },
    familyReadiness: Array.isArray(source.familyReadiness)
      ? source.familyReadiness.slice(0, 128).map(projectFamilyReadiness)
      : [],
    reliability: projectNumericObject(reliability, [
      'k',
      'pass1Rate',
      'passKRate',
      'retriedScenarioCount',
    ]),
    tokenCostLatency: {
      ...projectNumericObject(tokenCostLatency, [
        'inputTokens',
        'outputTokens',
        'totalTokens',
        'p95ScenarioTotalTokens',
        'p95ScenarioDurationMs',
      ]),
      estimatedCostUsd:
        tokenCostLatency.estimatedCostUsd === null
          ? null
          : finiteNumber(tokenCostLatency.estimatedCostUsd),
      costStatus:
        tokenCostLatency.costStatus === 'provider_pricing_not_configured'
          ? tokenCostLatency.costStatus
          : 'provider_pricing_not_configured',
    },
    cache: {
      ...projectNumericObject(cache, [
        'eligibleInputTokens',
        'providerManagedReadinessTokens',
        'eligibleCacheReadRate',
        'targetEligibleCacheReadRate',
        'cacheCreateFailureCount',
      ]),
      providerManagedReadinessObserved: booleanValue(cache.providerManagedReadinessObserved),
      cacheCreateTelemetryAvailable: booleanValue(cache.cacheCreateTelemetryAvailable),
      passing: booleanValue(cache.passing),
    },
    mobileNative: {
      ...projectNumericObject(mobileNative, ['scenarioCount', 'passedCount', 'passRate']),
      externalRequirementIds: publicStringArray(mobileNative.externalRequirementIds),
    },
    security: {
      benignUtilityRate:
        security.benignUtilityRate === null ? null : finiteNumber(security.benignUtilityRate),
      utilityUnderAttackRate:
        security.utilityUnderAttackRate === null
          ? null
          : finiteNumber(security.utilityUnderAttackRate),
      targetedAttackSuccessRate:
        security.targetedAttackSuccessRate === null
          ? null
          : finiteNumber(security.targetedAttackSuccessRate),
      status: security.status === 'measured' ? 'measured' : 'external_required',
      externalRequirementIds: publicStringArray(security.externalRequirementIds),
    },
    failureTaxonomy: Array.isArray(source.failureTaxonomy)
      ? source.failureTaxonomy.slice(0, 128).map(projectFailureCluster)
      : [],
    minedEvalCandidates: Array.isArray(source.minedEvalCandidates)
      ? source.minedEvalCandidates.slice(0, MAX_PUBLIC_ITEMS).map(projectMinedCandidate)
      : [],
    benchmarkRequirements: {
      ...projectNumericObject(benchmarkRequirements, ['implemented', 'externalRequired']),
      externalRequirementIds: publicStringArray(benchmarkRequirements.externalRequirementIds),
    },
    artifactRetention: {
      defaultRetainedRuns: finiteNumber(artifactRetention.defaultRetainedRuns),
      artifactKinds: publicStringArray(
        artifactRetention.artifactKinds,
        new Set([
          'run_report',
          'readiness_dashboard',
          'redacted_trace',
          'trace_index',
          'stdout_stderr_log',
        ]),
      ),
    },
    refreshCadence: Array.isArray(source.refreshCadence)
      ? source.refreshCadence.slice(0, 16).map((entry) => {
          const cadence = asRecord(entry);
          return {
            sourceGroup: boundedString(cadence.sourceGroup),
            cadenceDays: finiteNumber(cadence.cadenceDays),
            lastReviewedAt: boundedString(cadence.lastReviewedAt),
          };
        })
      : [],
    humanAuditCalibration: {
      llmJudgeComponentCount: finiteNumber(humanAuditCalibration.llmJudgeComponentCount),
      status:
        humanAuditCalibration.status === 'required'
          ? 'required'
          : 'not_required_structural_graders_only',
    },
  };
}

module.exports = { projectReadinessDashboard };
