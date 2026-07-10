const { hashPrivateString, safePublicToolName } = require('./publicTraceSchema');
const {
  ASSESSMENT_DIMENSION_PUBLIC_META,
  ASSESSMENT_DIMENSIONS,
  BENCHMARK_FAMILY_PUBLIC_META,
  BENCHMARK_FAMILIES,
  CONTENT_CLASSES,
  GRAPH_STATUSES,
  isPublicEvaluationId,
  MAX_PUBLIC_ITEMS,
  READINESS_CRITERIA,
  RUBRIC_KINDS,
} = require('./publicProjectionPolicy');
const { projectReadinessDashboard } = require('./publicReadinessDashboardProjection');

const RUN_REPORT_SCHEMA_VERSION = 'e2e-run-report-v2';

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

function optionalString(value, maxLength = 512) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined;
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

function canonicalStringArray(value, allowedValues, fieldName, maxItems = MAX_PUBLIC_ITEMS) {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.some((entry) => typeof entry !== 'string' || !allowedValues.has(entry))) {
    throw new Error(`Public E2E report contains an invalid ${fieldName}.`);
  }
  return publicStringArray(value, allowedValues, maxItems);
}

function publicEvaluationId(value, fieldName) {
  if (!isPublicEvaluationId(value)) {
    throw new Error(`Public E2E report contains an invalid ${fieldName}.`);
  }
  return value;
}

function publicEvaluationIdArray(value, fieldName, maxItems = MAX_PUBLIC_ITEMS) {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.some((entry) => !isPublicEvaluationId(entry))) {
    throw new Error(`Public E2E report contains an invalid ${fieldName}.`);
  }
  return publicStringArray(value, undefined, maxItems);
}

function projectNumericObject(value, keys) {
  const source = asRecord(value);
  return Object.fromEntries(keys.map((key) => [key, finiteNumber(source[key])]));
}

function projectTokenBuckets(value) {
  return projectNumericObject(value, [
    'systemPromptTokens',
    'toolDeclarationTokens',
    'memoryContextTokens',
    'conversationHistoryTokens',
    'userTurnTokens',
    'toolResultTokens',
  ]);
}

function projectRawPromptCache(value) {
  const source = asRecord(value);
  const countKeys = [
    'eligibleTurnCount',
    'enabledTurnCount',
    'skippedTurnCount',
    'createEventCount',
    'reuseEventCount',
    'providerManagedEventCount',
  ];
  const projected = projectNumericObject(source, countKeys);
  projected.thresholdTokens = Array.isArray(source.thresholdTokens)
    ? source.thresholdTokens.filter(Number.isFinite).slice(0, 64)
    : [];
  projected.explicitCacheNameHashes = Array.isArray(source.explicitCacheNames)
    ? source.explicitCacheNames
        .filter((name) => typeof name === 'string')
        .slice(0, 128)
        .map(hashPrivateString)
    : [];
  projected.reasonCounts = Array.isArray(source.reasonCounts)
    ? source.reasonCounts.slice(0, 128).map((entry) => {
        const reason = asRecord(entry).reason;
        return {
          reasonHash: hashPrivateString(typeof reason === 'string' ? reason : ''),
          count: finiteNumber(asRecord(entry).count),
        };
      })
    : [];
  projected.events = Array.isArray(source.events)
    ? source.events.slice(0, MAX_PUBLIC_ITEMS).map((entry) => {
        const event = asRecord(entry);
        const output = {
          eligible: booleanValue(event.eligible),
          enabled: booleanValue(event.enabled),
          estimatedInputTokens: finiteNumber(event.estimatedInputTokens),
          thresholdTokens: finiteNumber(event.thresholdTokens),
          providerFamilyHash: hashPrivateString(event.providerFamily),
          modeHash: hashPrivateString(event.mode),
          eventHash: hashPrivateString(event.event),
          reasonHash: hashPrivateString(event.reason),
        };
        for (const [sourceKey, targetKey] of [
          ['hostedFamily', 'hostedFamilyHash'],
          ['explicitCacheName', 'explicitCacheNameHash'],
          ['stableSystemPromptDigest', 'stableSystemPromptDigestHash'],
          ['stableToolDeclarationDigest', 'stableToolDeclarationDigestHash'],
          ['cacheablePrefixDigest', 'cacheablePrefixDigestHash'],
          ['toolDeclarationDigest', 'toolDeclarationDigestHash'],
          ['prefixDivergenceReason', 'prefixDivergenceReasonHash'],
        ]) {
          if (typeof event[sourceKey] === 'string' && event[sourceKey]) {
            output[targetKey] = hashPrivateString(event[sourceKey]);
          }
        }
        return output;
      })
    : [];
  if (source.prefixStability && typeof source.prefixStability === 'object') {
    projected.prefixStability = projectNumericObject(source.prefixStability, [
      'eventCount',
      'stableSystemPromptDigestEventCount',
      'stableToolDeclarationDigestEventCount',
      'cacheablePrefixDigestEventCount',
      'toolDeclarationDigestEventCount',
      'uniqueStableSystemPromptDigestCount',
      'uniqueStableToolDeclarationDigestCount',
      'uniqueCacheablePrefixDigestCount',
      'uniqueToolDeclarationDigestCount',
      'stableSystemPromptDigestPerEvent',
      'stableToolDeclarationDigestPerEvent',
      'cacheablePrefixDigestPerEvent',
      'toolDeclarationDigestPerEvent',
      'longestStableSystemPromptRun',
      'longestStableToolDeclarationRun',
      'longestCacheablePrefixRun',
      'longestToolDeclarationRun',
    ]);
  }
  return projected;
}

function projectUsage(value) {
  const source = asRecord(value);
  const projected = projectNumericObject(source, [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'totalTokens',
    'eventCount',
  ]);
  if (source.tokenBuckets && typeof source.tokenBuckets === 'object') {
    projected.tokenBuckets = projectTokenBuckets(source.tokenBuckets);
  }
  if (source.promptCache && typeof source.promptCache === 'object') {
    projected.promptCache = projectRawPromptCache(source.promptCache);
  }
  return projected;
}

function parseRubricKind(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const kind = value.split(':').at(-1);
  return RUBRIC_KINDS.has(kind) ? kind : undefined;
}

function projectRubricFailure(value) {
  const source = asRecord(value);
  const rubricKind = parseRubricKind(source.fixtureId);
  const detail = optionalString(source.detail, 16_384);
  return {
    ...(rubricKind ? { rubricKind } : {}),
    failureIdHash: hashPrivateString(source.fixtureId),
    ...(detail ? { detailHash: hashPrivateString(detail) } : {}),
  };
}

function projectRubricRisk(value) {
  const source = asRecord(value);
  const rubricKind = RUBRIC_KINDS.has(source.rubricKind) ? source.rubricKind : undefined;
  return {
    ...(rubricKind ? { rubricKind } : {}),
    rubricKindHash: hashPrivateString(source.rubricKind),
    reasonHash: hashPrivateString(source.reason),
  };
}

function projectRubricAudit(value) {
  const source = asRecord(value);
  return {
    ...projectNumericObject(source, [
      'rubricCount',
      'assistantProseRubricCount',
      'weakPatternRubricCount',
      'structuralSubstringRubricCount',
    ]),
    risks: Array.isArray(source.risks)
      ? source.risks.slice(0, MAX_PUBLIC_ITEMS).map(projectRubricRisk)
      : [],
  };
}

function projectLoopDiagnostics(value) {
  const source = asRecord(value);
  const repeatedToolCalls = Array.isArray(source.repeatedToolCalls)
    ? source.repeatedToolCalls.slice(0, MAX_PUBLIC_ITEMS).map((entry) => {
        const call = asRecord(entry);
        const name = safePublicToolName(call.name);
        return {
          ...(name ? { name } : {}),
          nameHash: hashPrivateString(call.name),
          argumentsFingerprintHash: hashPrivateString(call.argsHash),
          count: finiteNumber(call.count),
          noNewEvidence: booleanValue(call.noNewEvidence),
        };
      })
    : [];
  const repeatedHoldReasons = Array.isArray(source.repeatedHoldReasons)
    ? source.repeatedHoldReasons.slice(0, MAX_PUBLIC_ITEMS).map((entry) => {
        const hold = asRecord(entry);
        return {
          reasonHash: hashPrivateString(hold.reason),
          count: finiteNumber(hold.count),
        };
      })
    : [];
  return {
    repeatedToolCalls,
    repeatedCatalogAfterActivationCount: finiteNumber(source.repeatedCatalogAfterActivationCount),
    repeatedHoldReasons,
    passing: booleanValue(source.passing),
  };
}

function projectScenarioCache(value) {
  const source = asRecord(value);
  return {
    ...projectNumericObject(source, [
      'inputTokens',
      'eligibleInputTokens',
      'providerManagedReadinessTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'cacheReadRate',
      'eligibleCacheReadRate',
    ]),
    eligible: booleanValue(source.eligible),
  };
}

function projectScenario(value) {
  const source = asRecord(value);
  if (!CONTENT_CLASSES.has(source.contentClass)) {
    throw new Error('Public E2E report contains an invalid scenario contentClass.');
  }
  const detail = optionalString(source.detail, 65_536);
  const errors = Array.isArray(source.errors)
    ? source.errors.filter((error) => typeof error === 'string').slice(0, 128)
    : [];
  const graphStatus = GRAPH_STATUSES.has(source.graphStatus) ? source.graphStatus : null;
  const failedRubrics = Array.isArray(source.failedRubrics)
    ? source.failedRubrics.slice(0, MAX_PUBLIC_ITEMS).map(projectRubricFailure)
    : [];
  return {
    suite: publicEvaluationId(source.suite, 'scenario suite'),
    fixtureId: publicEvaluationId(source.fixtureId, 'scenario fixtureId'),
    contentClass: source.contentClass,
    passed: booleanValue(source.passed),
    attemptCount: finiteNumber(source.attemptCount, 1),
    durationMs: finiteNumber(source.durationMs),
    completed: booleanValue(source.completed),
    userTurnCount: finiteNumber(source.userTurnCount),
    toolCallCount: finiteNumber(source.toolCallCount),
    turnCount: finiteNumber(source.turnCount, finiteNumber(source.userTurnCount)),
    graphStatus,
    usage: projectUsage(source.usage),
    tokenBuckets: projectTokenBuckets(source.tokenBuckets ?? asRecord(source.usage).tokenBuckets),
    cache: projectScenarioCache(source.cache),
    loopDiagnostics: projectLoopDiagnostics(source.loopDiagnostics),
    benchmarkFamilies: canonicalStringArray(
      source.benchmarkFamilies,
      BENCHMARK_FAMILIES,
      'scenario benchmark family',
    ),
    assessmentDimensions: canonicalStringArray(
      source.assessmentDimensions,
      ASSESSMENT_DIMENSIONS,
      'scenario assessment dimension',
    ),
    ...(source.rubricPassed !== undefined
      ? { rubricPassed: finiteNumber(source.rubricPassed) }
      : {}),
    ...(source.rubricTotal !== undefined ? { rubricTotal: finiteNumber(source.rubricTotal) } : {}),
    ...(failedRubrics.length > 0 ? { failedRubrics } : {}),
    rubricAudit: projectRubricAudit(source.rubricAudit),
    ...(detail ? { detailHash: hashPrivateString(detail) } : {}),
    errorCount: errors.length,
    errorHashes: errors.map(hashPrivateString),
  };
}

function projectRunMetadata(value) {
  const source = asRecord(value);
  const projected = {
    gitSha: boundedString(source.gitSha),
    provider: boundedString(source.provider),
    hostedFamily: boundedString(source.hostedFamily),
    model: boundedString(source.model),
    modelIdentitySource:
      source.modelIdentitySource === 'explicit-public-id'
        ? 'explicit-public-id'
        : 'provider-model-id',
    modelLocatorSha256:
      typeof source.modelLocatorSha256 === 'string' &&
      /^[a-f0-9]{64}$/u.test(source.modelLocatorSha256)
        ? source.modelLocatorSha256
        : '0'.repeat(64),
    endpointSha256: boundedString(source.endpointSha256),
    scenarioManifestVersion: boundedString(source.scenarioManifestVersion),
    promptCacheMode: boundedString(source.promptCacheMode),
    nativeToolFixtureVersion: boundedString(source.nativeToolFixtureVersion),
    collectMode: booleanValue(source.collectMode),
  };
  for (const key of ['providerId', 'modelVersion']) {
    const string = optionalString(source[key]);
    if (string) {
      projected[key] = string;
    }
  }
  if (typeof source.temperature === 'number' && Number.isFinite(source.temperature)) {
    projected.temperature = source.temperature;
  }
  if (Number.isSafeInteger(source.seed) && source.seed >= 0) {
    projected.seed = source.seed;
  }
  return projected;
}

function projectCacheFailure(value) {
  const source = asRecord(value);
  return {
    providerStatusHash: hashPrivateString(source.providerStatus),
    count: finiteNumber(source.count),
  };
}

function projectCacheTelemetry(value) {
  const source = asRecord(value);
  return {
    ...projectNumericObject(source, [
      'eligibleTurnCount',
      'enabledTurnCount',
      'skippedTurnCount',
      'createEventCount',
      'reuseEventCount',
      'providerManagedEventCount',
      'explicitCacheNameCount',
    ]),
    thresholdTokens: Array.isArray(source.thresholdTokens)
      ? source.thresholdTokens.filter(Number.isFinite).slice(0, 64)
      : [],
    reasonCounts: Array.isArray(source.reasonCounts)
      ? source.reasonCounts.slice(0, 128).map((entry) => ({
          reasonHash: hashPrivateString(asRecord(entry).reason),
          count: finiteNumber(asRecord(entry).count),
        }))
      : [],
    ...(source.prefixStability && typeof source.prefixStability === 'object'
      ? {
          prefixStability: projectRawPromptCache({ prefixStability: source.prefixStability })
            .prefixStability,
        }
      : {}),
  };
}

function projectCacheScenario(value) {
  const source = asRecord(value);
  return {
    fixtureId: publicEvaluationId(source.fixtureId, 'cache scenario fixtureId'),
    ...projectNumericObject(source, [
      'inputTokens',
      'eligibleInputTokens',
      'providerManagedReadinessTokens',
      'cacheReadTokens',
      'cacheReadRate',
      'eligibleCacheReadRate',
    ]),
    tokenBuckets: projectTokenBuckets(source.tokenBuckets),
  };
}

function projectCache(value) {
  const source = asRecord(value);
  return {
    ...projectNumericObject(source, [
      'inputTokens',
      'eligibleInputTokens',
      'providerManagedReadinessTokens',
      'cacheReadTokens',
      'eligibleCacheReadTokens',
      'cacheWriteTokens',
      'cacheReadRate',
      'eligibleCacheReadRate',
      'eligibleScenarioCount',
      'eligibleInputThreshold',
      'targetEligibleCacheReadRate',
      'cacheCreateAttempts',
      'cacheCreateFailureCount',
    ]),
    providerManagedReadinessObserved: booleanValue(source.providerManagedReadinessObserved),
    passing: booleanValue(source.passing),
    cacheCreateFailuresByProviderStatus: Array.isArray(source.cacheCreateFailuresByProviderStatus)
      ? source.cacheCreateFailuresByProviderStatus.slice(0, 128).map(projectCacheFailure)
      : [],
    cacheCreateTelemetryAvailable: booleanValue(source.cacheCreateTelemetryAvailable),
    promptCacheTelemetry: projectCacheTelemetry(source.promptCacheTelemetry),
    scenarios: Array.isArray(source.scenarios)
      ? source.scenarios.slice(0, MAX_PUBLIC_ITEMS).map(projectCacheScenario)
      : [],
  };
}

function projectGraderAudit(value) {
  const source = asRecord(value);
  return {
    ...projectNumericObject(source, [
      'scenarioCount',
      'auditedScenarioCount',
      'rubricCount',
      'assistantProseRubricCount',
      'weakPatternRubricCount',
      'structuralSubstringRubricCount',
    ]),
    missingRubricAuditScenarioIds: publicEvaluationIdArray(
      source.missingRubricAuditScenarioIds,
      'grader audit scenario id',
    ),
    risks: Array.isArray(source.risks)
      ? source.risks.slice(0, MAX_PUBLIC_ITEMS).map(projectRubricRisk)
      : [],
    passing: booleanValue(source.passing),
  };
}

function projectAssessmentAxis(value, publicMeta, fieldName) {
  const source = asRecord(value);
  const id = source.id;
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(publicMeta, id)) {
    throw new Error(`Public E2E report contains an invalid ${fieldName}.`);
  }
  const meta = publicMeta[id];
  return {
    id,
    label: typeof meta === 'string' ? meta : meta.label,
    ...projectNumericObject(source, ['passed', 'total', 'passRate', 'targetPassRate']),
    passing: booleanValue(source.passing),
    scenarioIds: publicEvaluationIdArray(source.scenarioIds, `${fieldName} scenario id`),
    failedScenarioIds: publicEvaluationIdArray(
      source.failedScenarioIds,
      `${fieldName} failed scenario id`,
    ),
    ...(typeof meta === 'object' ? { externalReference: meta.externalReference } : {}),
  };
}

function projectAssessment(value) {
  const source = asRecord(value);
  return {
    generatedAt: boundedString(source.generatedAt),
    ...projectNumericObject(source, ['scenarioCount', 'overallScenarioPassRate', 'evidenceScore']),
    dimensions: Array.isArray(source.dimensions)
      ? source.dimensions
          .slice(0, 128)
          .map((axis) =>
            projectAssessmentAxis(axis, ASSESSMENT_DIMENSION_PUBLIC_META, 'assessment dimension'),
          )
      : [],
    benchmarkFamilies: Array.isArray(source.benchmarkFamilies)
      ? source.benchmarkFamilies
          .slice(0, 128)
          .map((axis) =>
            projectAssessmentAxis(axis, BENCHMARK_FAMILY_PUBLIC_META, 'benchmark family'),
          )
      : [],
    dimensionsPassing: booleanValue(source.dimensionsPassing),
    benchmarkFamiliesPassing: booleanValue(source.benchmarkFamiliesPassing),
  };
}

function projectReliabilityScenario(value) {
  const source = asRecord(value);
  return {
    fixtureId: publicEvaluationId(source.fixtureId, 'reliability scenario fixtureId'),
    passed: booleanValue(source.passed),
    ...projectNumericObject(source, ['attemptCount', 'k', 'retriesUsed']),
    passAt1: booleanValue(source.passAt1),
    passAtK: booleanValue(source.passAtK),
  };
}

function projectReliability(value) {
  const source = asRecord(value);
  return {
    ...projectNumericObject(source, [
      'k',
      'scenarioCount',
      'pass1PassedCount',
      'passKPassedCount',
      'pass1Rate',
      'passKRate',
      'retriedScenarioCount',
    ]),
    scenarios: Array.isArray(source.scenarios)
      ? source.scenarios.slice(0, MAX_PUBLIC_ITEMS).map(projectReliabilityScenario)
      : [],
  };
}

function projectReadiness(value) {
  const source = asRecord(value);
  return {
    passing: booleanValue(source.passing),
    ...projectNumericObject(source, [
      'targetScenarioCount',
      'targetScenarioPassRate',
      'targetAxisPassRate',
      'scenarioPassRate',
      'pass1Rate',
      'passKRate',
      'cacheEligibleReadRate',
      'criticalFailureCount',
    ]),
    cachePassing: booleanValue(source.cachePassing),
    graderAuditPassing: booleanValue(source.graderAuditPassing),
    criticalFailedScenarioIds: publicEvaluationIdArray(
      source.criticalFailedScenarioIds,
      'critical failed scenario id',
    ),
    failedCriteria: canonicalStringArray(
      source.failedCriteria,
      READINESS_CRITERIA,
      'readiness criterion',
    ),
  };
}

function projectPublicRunReport(value) {
  const source = asRecord(value);
  if (source.schemaVersion !== RUN_REPORT_SCHEMA_VERSION) {
    throw new Error(`Public E2E report requires ${RUN_REPORT_SCHEMA_VERSION}`);
  }
  return {
    schemaVersion: RUN_REPORT_SCHEMA_VERSION,
    generatedAt: boundedString(source.generatedAt),
    maxScenarioRetries: finiteNumber(source.maxScenarioRetries),
    runMetadata: projectRunMetadata(source.runMetadata),
    scenarios: Array.isArray(source.scenarios)
      ? source.scenarios.slice(0, MAX_PUBLIC_ITEMS).map(projectScenario)
      : [],
    totals: projectNumericObject(source.totals, [
      'scenarioCount',
      'passedCount',
      'failedCount',
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'totalTokens',
      'durationMs',
    ]),
    cache: projectCache(source.cache),
    graderAudit: projectGraderAudit(source.graderAudit),
    assessment: projectAssessment(source.assessment),
    reliability: projectReliability(source.reliability),
    readiness: projectReadiness(source.readiness),
    readinessDashboard: projectReadinessDashboard(source.readinessDashboard, projectRunMetadata),
    metricsPassing: booleanValue(source.metricsPassing),
  };
}

module.exports = {
  RUN_REPORT_SCHEMA_VERSION,
  projectPublicRunReport,
};
