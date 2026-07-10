const {
  ASSESSMENT_DIMENSIONS,
  BENCHMARK_FAMILIES,
  CONTENT_CLASSES,
  GRAPH_STATUSES,
  READINESS_CRITERIA,
  isPublicEvaluationId,
} = require('./publicProjectionPolicy');
const { RUN_REPORT_SCHEMA_VERSION } = require('./constants');
const {
  assertPublicHostedFamily,
  assertPublicModelId,
  assertPublicRevision,
  resolvePromptCacheMode,
} = require('./provenance');

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_SHA_PATTERN = /^(?:unknown|[a-f0-9]{7,64})$/u;
const PUBLIC_PROVIDERS = new Set([
  'anthropic',
  'custom',
  'gemini',
  'on-device',
  'openai',
  'openrouter',
]);

const TOP_LEVEL_FIELDS = [
  'schemaVersion',
  'generatedAt',
  'maxScenarioRetries',
  'runMetadata',
  'scenarios',
  'totals',
  'cache',
  'graderAudit',
  'assessment',
  'reliability',
  'readiness',
  'readinessDashboard',
  'metricsPassing',
];
const RUN_METADATA_FIELDS = [
  'gitSha',
  'provider',
  'hostedFamily',
  'model',
  'modelIdentitySource',
  'modelLocatorSha256',
  'endpointSha256',
  'scenarioManifestVersion',
  'promptCacheMode',
  'nativeToolFixtureVersion',
  'collectMode',
];
const OPTIONAL_RUN_METADATA_FIELDS = ['providerId', 'modelVersion', 'temperature', 'seed'];
const SCENARIO_FIELDS = [
  'suite',
  'fixtureId',
  'contentClass',
  'passed',
  'attemptCount',
  'durationMs',
  'completed',
  'userTurnCount',
  'toolCallCount',
  'turnCount',
  'graphStatus',
  'usage',
  'tokenBuckets',
  'cache',
  'loopDiagnostics',
  'benchmarkFamilies',
  'assessmentDimensions',
  'rubricAudit',
  'errorCount',
  'errorHashes',
];
const OPTIONAL_SCENARIO_FIELDS = [
  'rubricPassed',
  'rubricTotal',
  'failedRubrics',
  'detailHash',
  'traceArtifact',
];
const TOTAL_FIELDS = [
  'scenarioCount',
  'passedCount',
  'failedCount',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'totalTokens',
  'durationMs',
];
const READINESS_FIELDS = [
  'passing',
  'targetScenarioCount',
  'targetScenarioPassRate',
  'targetAxisPassRate',
  'scenarioPassRate',
  'pass1Rate',
  'passKRate',
  'cacheEligibleReadRate',
  'criticalFailureCount',
  'cachePassing',
  'graderAuditPassing',
  'criticalFailedScenarioIds',
  'failedCriteria',
];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactFields(value, path, requiredFields, optionalFields = []) {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${path} in public E2E summary input.`);
  }
  const allowedFields = new Set([...requiredFields, ...optionalFields]);
  const unknownFields = Object.keys(value).filter((field) => !allowedFields.has(field));
  if (unknownFields.length > 0) {
    throw new Error(`Unknown ${path} fields: ${unknownFields.sort().join(', ')}.`);
  }
  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Missing ${path}.${field} in public E2E summary input.`);
    }
  }
}

function assertFiniteNumber(value, path, { integer = false, minimum } = {}) {
  if (
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value)) ||
    (minimum !== undefined && value < minimum)
  ) {
    throw new Error(`Invalid ${path} in public E2E summary input.`);
  }
}

function assertBoolean(value, path) {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${path} in public E2E summary input.`);
  }
}

function assertCanonicalStringArray(value, allowedValues, path) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || !allowedValues.has(entry))
  ) {
    throw new Error(`Invalid ${path} in public E2E summary input.`);
  }
}

function assertPublicEvaluationIdArray(value, path) {
  if (!Array.isArray(value) || value.some((entry) => !isPublicEvaluationId(entry))) {
    throw new Error(`Invalid ${path} in public E2E summary input.`);
  }
}

function assertIsoTimestamp(value, path) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`Invalid ${path} in public E2E summary input.`);
  }
}

function assertRunMetadata(value) {
  assertExactFields(
    value,
    'report.runMetadata',
    RUN_METADATA_FIELDS,
    OPTIONAL_RUN_METADATA_FIELDS,
  );
  if (!GIT_SHA_PATTERN.test(value.gitSha)) {
    throw new Error('Invalid report.runMetadata.gitSha in public E2E summary input.');
  }
  if (!PUBLIC_PROVIDERS.has(value.provider)) {
    throw new Error('Invalid report.runMetadata.provider in public E2E summary input.');
  }
  assertPublicHostedFamily(value.hostedFamily);
  assertPublicModelId(value.model);
  if (!['provider-model-id', 'explicit-public-id'].includes(value.modelIdentitySource)) {
    throw new Error('Invalid report.runMetadata.modelIdentitySource in public E2E summary input.');
  }
  for (const field of ['modelLocatorSha256', 'endpointSha256']) {
    if (typeof value[field] !== 'string' || !SHA256_PATTERN.test(value[field])) {
      throw new Error(`Invalid report.runMetadata.${field} in public E2E summary input.`);
    }
  }
  assertPublicRevision(value.scenarioManifestVersion, 'Scenario manifest version');
  assertPublicRevision(value.nativeToolFixtureVersion, 'Native tool fixture version');
  if (resolvePromptCacheMode(value.promptCacheMode) !== value.promptCacheMode) {
    throw new Error('Invalid report.runMetadata.promptCacheMode in public E2E summary input.');
  }
  assertBoolean(value.collectMode, 'report.runMetadata.collectMode');
  for (const field of ['providerId', 'modelVersion']) {
    if (value[field] !== undefined) {
      assertPublicRevision(value[field], field);
    }
  }
  if (value.temperature !== undefined) {
    assertFiniteNumber(value.temperature, 'report.runMetadata.temperature');
  }
  if (value.seed !== undefined) {
    assertFiniteNumber(value.seed, 'report.runMetadata.seed', { integer: true, minimum: 0 });
  }
}

function assertScenario(value, index) {
  const path = `report.scenarios[${index}]`;
  assertExactFields(value, path, SCENARIO_FIELDS, OPTIONAL_SCENARIO_FIELDS);
  if (!isPublicEvaluationId(value.suite) || !isPublicEvaluationId(value.fixtureId)) {
    throw new Error(`Invalid ${path} identity in public E2E summary input.`);
  }
  if (!CONTENT_CLASSES.has(value.contentClass)) {
    throw new Error(`Invalid ${path}.contentClass in public E2E summary input.`);
  }
  for (const field of ['passed', 'completed']) {
    assertBoolean(value[field], `${path}.${field}`);
  }
  for (const field of [
    'attemptCount',
    'durationMs',
    'userTurnCount',
    'toolCallCount',
    'turnCount',
    'errorCount',
  ]) {
    assertFiniteNumber(value[field], `${path}.${field}`, { minimum: 0 });
  }
  if (value.graphStatus !== null && !GRAPH_STATUSES.has(value.graphStatus)) {
    throw new Error(`Invalid ${path}.graphStatus in public E2E summary input.`);
  }
  if (!isRecord(value.usage)) {
    throw new Error(`Invalid ${path}.usage in public E2E summary input.`);
  }
  for (const field of ['totalTokens', 'cacheReadTokens']) {
    assertFiniteNumber(value.usage[field], `${path}.usage.${field}`, { minimum: 0 });
  }
  if (!isRecord(value.loopDiagnostics)) {
    throw new Error(`Invalid ${path}.loopDiagnostics in public E2E summary input.`);
  }
  assertBoolean(value.loopDiagnostics.passing, `${path}.loopDiagnostics.passing`);
  if (!Array.isArray(value.loopDiagnostics.repeatedToolCalls)) {
    throw new Error(`Invalid ${path}.loopDiagnostics.repeatedToolCalls in public E2E summary input.`);
  }
  assertCanonicalStringArray(
    value.benchmarkFamilies,
    BENCHMARK_FAMILIES,
    `${path}.benchmarkFamilies`,
  );
  assertCanonicalStringArray(
    value.assessmentDimensions,
    ASSESSMENT_DIMENSIONS,
    `${path}.assessmentDimensions`,
  );
  if (!Array.isArray(value.errorHashes)) {
    throw new Error(`Invalid ${path}.errorHashes in public E2E summary input.`);
  }
  if (value.failedRubrics !== undefined && !Array.isArray(value.failedRubrics)) {
    throw new Error(`Invalid ${path}.failedRubrics in public E2E summary input.`);
  }
}

function parsePublicE2eReportSummaryInput(value) {
  assertExactFields(value, 'report', TOP_LEVEL_FIELDS);
  if (value.schemaVersion !== RUN_REPORT_SCHEMA_VERSION) {
    throw new Error(`Summary input must use ${RUN_REPORT_SCHEMA_VERSION}.`);
  }
  assertIsoTimestamp(value.generatedAt, 'report.generatedAt');
  assertFiniteNumber(value.maxScenarioRetries, 'report.maxScenarioRetries', {
    integer: true,
    minimum: 0,
  });
  assertRunMetadata(value.runMetadata);
  if (!Array.isArray(value.scenarios)) {
    throw new Error('Invalid report.scenarios in public E2E summary input.');
  }
  value.scenarios.forEach(assertScenario);
  assertExactFields(value.totals, 'report.totals', TOTAL_FIELDS);
  for (const field of TOTAL_FIELDS) {
    assertFiniteNumber(value.totals[field], `report.totals.${field}`, { minimum: 0 });
  }
  if (!isRecord(value.cache)) {
    throw new Error('Invalid report.cache in public E2E summary input.');
  }
  for (const field of ['eligibleCacheReadRate', 'targetEligibleCacheReadRate']) {
    assertFiniteNumber(value.cache[field], `report.cache.${field}`, { minimum: 0 });
  }
  assertBoolean(value.cache.passing, 'report.cache.passing');
  if (!isRecord(value.graderAudit)) {
    throw new Error('Invalid report.graderAudit in public E2E summary input.');
  }
  assertBoolean(value.graderAudit.passing, 'report.graderAudit.passing');
  if (!isRecord(value.assessment)) {
    throw new Error('Invalid report.assessment in public E2E summary input.');
  }
  assertFiniteNumber(value.assessment.evidenceScore, 'report.assessment.evidenceScore', {
    minimum: 0,
  });
  assertBoolean(value.assessment.dimensionsPassing, 'report.assessment.dimensionsPassing');
  if (!isRecord(value.reliability)) {
    throw new Error('Invalid report.reliability in public E2E summary input.');
  }
  for (const field of [
    'k',
    'scenarioCount',
    'pass1PassedCount',
    'passKPassedCount',
    'retriedScenarioCount',
  ]) {
    assertFiniteNumber(value.reliability[field], `report.reliability.${field}`, { minimum: 0 });
  }
  assertExactFields(value.readiness, 'report.readiness', READINESS_FIELDS);
  assertBoolean(value.readiness.passing, 'report.readiness.passing');
  assertCanonicalStringArray(
    value.readiness.failedCriteria,
    READINESS_CRITERIA,
    'report.readiness.failedCriteria',
  );
  assertPublicEvaluationIdArray(
    value.readiness.criticalFailedScenarioIds,
    'report.readiness.criticalFailedScenarioIds',
  );
  if (!isRecord(value.readinessDashboard)) {
    throw new Error('Invalid report.readinessDashboard in public E2E summary input.');
  }
  assertBoolean(value.metricsPassing, 'report.metricsPassing');
  return {
    generatedAt: value.generatedAt,
    runMetadata: {
      gitSha: value.runMetadata.gitSha,
      provider: value.runMetadata.provider,
      model: value.runMetadata.model,
      scenarioManifestVersion: value.runMetadata.scenarioManifestVersion,
    },
    totals: Object.fromEntries(TOTAL_FIELDS.map((field) => [field, value.totals[field]])),
    cache: {
      eligibleCacheReadRate: value.cache.eligibleCacheReadRate,
      targetEligibleCacheReadRate: value.cache.targetEligibleCacheReadRate,
      passing: value.cache.passing,
    },
    graderAudit: { passing: value.graderAudit.passing },
    assessment: {
      evidenceScore: value.assessment.evidenceScore,
      dimensionsPassing: value.assessment.dimensionsPassing,
    },
    reliability: Object.fromEntries(
      [
        'k',
        'scenarioCount',
        'pass1PassedCount',
        'passKPassedCount',
        'retriedScenarioCount',
      ].map((field) => [field, value.reliability[field]]),
    ),
    readiness: {
      passing: value.readiness.passing,
      failedCriteria: [...value.readiness.failedCriteria],
    },
    metricsPassing: value.metricsPassing,
    scenarios: value.scenarios.map((scenario) => ({
      fixtureId: scenario.fixtureId,
      passed: scenario.passed,
      attemptCount: scenario.attemptCount,
      durationMs: scenario.durationMs,
      toolCallCount: scenario.toolCallCount,
      graphStatus: scenario.graphStatus,
      usage: {
        totalTokens: scenario.usage.totalTokens,
        cacheReadTokens: scenario.usage.cacheReadTokens,
      },
      errorCount: scenario.errorCount,
      failedRubricCount: scenario.failedRubrics?.length ?? 0,
      loopDiagnosticsPassing: scenario.loopDiagnostics.passing,
      repeatedToolCallCount: scenario.loopDiagnostics.repeatedToolCalls.length,
    })),
  };
}

module.exports = {
  parsePublicE2eReportSummaryInput,
};
