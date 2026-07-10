const fs = require('fs');
const { isDeepStrictEqual } = require('util');

const { atomicWriteFileSync } = require('./fileTransaction');
const { projectPublicRedactedTrace } = require('./publicTraceSchema');

const PARTIAL_REPORT_SCHEMA_VERSION = 'e2e-partial-report-v2';
const SCENARIO_ENTRY_SCHEMA_VERSION = 'e2e-run-report-scenario-v2';

const REQUIRED_ENTRY_FIELDS = [
  'schemaVersion',
  'suite',
  'fixtureId',
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
  'errors',
];

const OPTIONAL_ENTRY_FIELDS = [
  'promptCache',
  'rubricPassed',
  'rubricTotal',
  'failedRubrics',
  'trace',
  'detail',
];

const ENTRY_FIELDS = new Set([...REQUIRED_ENTRY_FIELDS, ...OPTIONAL_ENTRY_FIELDS]);
const GRAPH_STATUSES = new Set([
  'ready',
  'model_turn',
  'awaiting_tool_results',
  'recovering',
  'waiting_async',
  'awaiting_review',
  'blocked',
  'finalized',
  'yielded',
  'cancelled',
  'failed',
]);
const TOKEN_BUCKET_FIELDS = [
  'systemPromptTokens',
  'toolDeclarationTokens',
  'memoryContextTokens',
  'conversationHistoryTokens',
  'userTurnTokens',
  'toolResultTokens',
];
const PROMPT_CACHE_COUNT_FIELDS = [
  'eligibleTurnCount',
  'enabledTurnCount',
  'skippedTurnCount',
  'createEventCount',
  'reuseEventCount',
  'providerManagedEventCount',
];
const PREFIX_STABILITY_FIELDS = [
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
];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertFiniteNumber(value, fieldPath, { integer = false, minimum = 0 } = {}) {
  if (!Number.isFinite(value) || value < minimum || (integer && !Number.isInteger(value))) {
    throw new Error(`Invalid ${fieldPath} in current evaluation partial report.`);
  }
}

function assertStringArray(value, fieldPath) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Invalid ${fieldPath} in current evaluation partial report.`);
  }
}

function assertExactFields(value, fieldPath, requiredFields, optionalFields = []) {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${fieldPath} in current evaluation partial report.`);
  }
  const allowedFields = new Set([...requiredFields, ...optionalFields]);
  const unknownFields = Object.keys(value).filter((field) => !allowedFields.has(field));
  if (unknownFields.length > 0) {
    throw new Error(`Unknown ${fieldPath} fields: ${unknownFields.sort().join(', ')}.`);
  }
  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Missing ${fieldPath}.${field} in current evaluation partial report.`);
    }
  }
}

function assertNumberFields(value, fieldPath, fields) {
  for (const field of fields) {
    assertFiniteNumber(value[field], `${fieldPath}.${field}`);
  }
}

function assertTokenBuckets(value, fieldPath) {
  assertExactFields(value, fieldPath, TOKEN_BUCKET_FIELDS);
  assertNumberFields(value, fieldPath, TOKEN_BUCKET_FIELDS);
}

function assertPromptCache(value, fieldPath) {
  const requiredFields = [
    ...PROMPT_CACHE_COUNT_FIELDS,
    'thresholdTokens',
    'explicitCacheNames',
    'reasonCounts',
    'events',
  ];
  assertExactFields(value, fieldPath, requiredFields, ['prefixStability']);
  for (const field of PROMPT_CACHE_COUNT_FIELDS) {
    assertFiniteNumber(value[field], `${fieldPath}.${field}`, { integer: true });
  }
  if (!Array.isArray(value.thresholdTokens)) {
    throw new Error(`Invalid ${fieldPath}.thresholdTokens in current evaluation partial report.`);
  }
  value.thresholdTokens.forEach((tokenCount, index) =>
    assertFiniteNumber(tokenCount, `${fieldPath}.thresholdTokens[${index}]`, { integer: true }),
  );
  assertStringArray(value.explicitCacheNames, `${fieldPath}.explicitCacheNames`);
  if (!Array.isArray(value.reasonCounts)) {
    throw new Error(`Invalid ${fieldPath}.reasonCounts in current evaluation partial report.`);
  }
  value.reasonCounts.forEach((entry, index) => {
    const entryPath = `${fieldPath}.reasonCounts[${index}]`;
    assertExactFields(entry, entryPath, ['reason', 'count']);
    if (typeof entry.reason !== 'string') {
      throw new Error(`Invalid ${entryPath}.reason in current evaluation partial report.`);
    }
    assertFiniteNumber(entry.count, `${entryPath}.count`, { integer: true });
  });
  if (!Array.isArray(value.events)) {
    throw new Error(`Invalid ${fieldPath}.events in current evaluation partial report.`);
  }
  const eventRequiredFields = [
    'eligible',
    'enabled',
    'estimatedInputTokens',
    'thresholdTokens',
    'providerFamily',
    'mode',
    'event',
    'reason',
  ];
  const eventOptionalFields = [
    'hostedFamily',
    'explicitCacheName',
    'stableSystemPromptDigest',
    'stableToolDeclarationDigest',
    'cacheablePrefixDigest',
    'toolDeclarationDigest',
    'prefixDivergenceReason',
  ];
  value.events.forEach((event, index) => {
    const eventPath = `${fieldPath}.events[${index}]`;
    assertExactFields(event, eventPath, eventRequiredFields, eventOptionalFields);
    for (const field of ['eligible', 'enabled']) {
      if (typeof event[field] !== 'boolean') {
        throw new Error(`Invalid ${eventPath}.${field} in current evaluation partial report.`);
      }
    }
    for (const field of ['estimatedInputTokens', 'thresholdTokens']) {
      assertFiniteNumber(event[field], `${eventPath}.${field}`);
    }
    for (const field of ['providerFamily', 'mode', 'event', 'reason', ...eventOptionalFields]) {
      if (event[field] !== undefined && typeof event[field] !== 'string') {
        throw new Error(`Invalid ${eventPath}.${field} in current evaluation partial report.`);
      }
    }
  });
  if (value.prefixStability !== undefined) {
    assertExactFields(
      value.prefixStability,
      `${fieldPath}.prefixStability`,
      PREFIX_STABILITY_FIELDS,
    );
    assertNumberFields(
      value.prefixStability,
      `${fieldPath}.prefixStability`,
      PREFIX_STABILITY_FIELDS,
    );
  }
}

function assertUsage(value, fieldPath) {
  const numericFields = [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'totalTokens',
    'eventCount',
  ];
  assertExactFields(value, fieldPath, numericFields, ['tokenBuckets', 'promptCache']);
  assertNumberFields(value, fieldPath, numericFields);
  if (value.tokenBuckets !== undefined) {
    assertTokenBuckets(value.tokenBuckets, `${fieldPath}.tokenBuckets`);
  }
  if (value.promptCache !== undefined) {
    assertPromptCache(value.promptCache, `${fieldPath}.promptCache`);
  }
}

function assertScenarioCache(value, fieldPath) {
  const numericFields = [
    'inputTokens',
    'eligibleInputTokens',
    'providerManagedReadinessTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'cacheReadRate',
    'eligibleCacheReadRate',
  ];
  assertExactFields(value, fieldPath, [...numericFields, 'eligible']);
  assertNumberFields(value, fieldPath, numericFields);
  if (typeof value.eligible !== 'boolean') {
    throw new Error(`Invalid ${fieldPath}.eligible in current evaluation partial report.`);
  }
}

function assertLoopDiagnostics(value, fieldPath) {
  assertExactFields(value, fieldPath, [
    'repeatedToolCalls',
    'repeatedCatalogAfterActivationCount',
    'repeatedHoldReasons',
    'passing',
  ]);
  if (!Array.isArray(value.repeatedToolCalls) || !Array.isArray(value.repeatedHoldReasons)) {
    throw new Error(`Invalid ${fieldPath} arrays in current evaluation partial report.`);
  }
  value.repeatedToolCalls.forEach((entry, index) => {
    const entryPath = `${fieldPath}.repeatedToolCalls[${index}]`;
    assertExactFields(entry, entryPath, ['name', 'argsHash', 'count', 'noNewEvidence']);
    if (typeof entry.name !== 'string' || typeof entry.argsHash !== 'string') {
      throw new Error(`Invalid ${entryPath} in current evaluation partial report.`);
    }
    assertFiniteNumber(entry.count, `${entryPath}.count`, { integer: true });
    if (typeof entry.noNewEvidence !== 'boolean') {
      throw new Error(`Invalid ${entryPath}.noNewEvidence in current evaluation partial report.`);
    }
  });
  value.repeatedHoldReasons.forEach((entry, index) => {
    const entryPath = `${fieldPath}.repeatedHoldReasons[${index}]`;
    assertExactFields(entry, entryPath, ['reason', 'count']);
    if (typeof entry.reason !== 'string') {
      throw new Error(`Invalid ${entryPath}.reason in current evaluation partial report.`);
    }
    assertFiniteNumber(entry.count, `${entryPath}.count`, { integer: true });
  });
  assertFiniteNumber(
    value.repeatedCatalogAfterActivationCount,
    `${fieldPath}.repeatedCatalogAfterActivationCount`,
    { integer: true },
  );
  if (typeof value.passing !== 'boolean') {
    throw new Error(`Invalid ${fieldPath}.passing in current evaluation partial report.`);
  }
}

function assertRubricAudit(value, fieldPath) {
  const numericFields = [
    'rubricCount',
    'assistantProseRubricCount',
    'weakPatternRubricCount',
    'structuralSubstringRubricCount',
  ];
  assertExactFields(value, fieldPath, [...numericFields, 'risks']);
  for (const field of numericFields) {
    assertFiniteNumber(value[field], `${fieldPath}.${field}`, { integer: true });
  }
  if (!Array.isArray(value.risks)) {
    throw new Error(`Invalid ${fieldPath}.risks in current evaluation partial report.`);
  }
  value.risks.forEach((risk, index) => {
    const riskPath = `${fieldPath}.risks[${index}]`;
    assertExactFields(risk, riskPath, ['rubricKind', 'reason']);
    if (typeof risk.rubricKind !== 'string' || typeof risk.reason !== 'string') {
      throw new Error(`Invalid ${riskPath} in current evaluation partial report.`);
    }
  });
}

function assertScenarioEntry(entry, index) {
  const prefix = `entries[${index}]`;
  if (!isRecord(entry)) {
    throw new Error(`Invalid ${prefix} in current evaluation partial report.`);
  }
  const unknownFields = Object.keys(entry).filter((field) => !ENTRY_FIELDS.has(field));
  if (unknownFields.length > 0) {
    throw new Error(`Unknown ${prefix} fields: ${unknownFields.sort().join(', ')}.`);
  }
  for (const field of REQUIRED_ENTRY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(entry, field)) {
      throw new Error(`Missing ${prefix}.${field} in current evaluation partial report.`);
    }
  }
  if (entry.schemaVersion !== SCENARIO_ENTRY_SCHEMA_VERSION) {
    throw new Error(`Unsupported ${prefix}.schemaVersion in evaluation partial report.`);
  }
  for (const field of ['suite', 'fixtureId']) {
    if (typeof entry[field] !== 'string' || entry[field].trim().length === 0) {
      throw new Error(`Invalid ${prefix}.${field} in current evaluation partial report.`);
    }
  }
  for (const field of ['passed', 'completed']) {
    if (typeof entry[field] !== 'boolean') {
      throw new Error(`Invalid ${prefix}.${field} in current evaluation partial report.`);
    }
  }
  for (const field of [
    'attemptCount',
    'durationMs',
    'userTurnCount',
    'toolCallCount',
    'turnCount',
  ]) {
    assertFiniteNumber(entry[field], `${prefix}.${field}`, {
      integer: true,
      minimum: field === 'attemptCount' ? 1 : 0,
    });
  }
  if (entry.graphStatus !== null && !GRAPH_STATUSES.has(entry.graphStatus)) {
    throw new Error(`Invalid ${prefix}.graphStatus in current evaluation partial report.`);
  }
  assertUsage(entry.usage, `${prefix}.usage`);
  assertTokenBuckets(entry.tokenBuckets, `${prefix}.tokenBuckets`);
  assertScenarioCache(entry.cache, `${prefix}.cache`);
  assertLoopDiagnostics(entry.loopDiagnostics, `${prefix}.loopDiagnostics`);
  assertRubricAudit(entry.rubricAudit, `${prefix}.rubricAudit`);
  if (
    entry.usage.tokenBuckets !== undefined &&
    !isDeepStrictEqual(entry.usage.tokenBuckets, entry.tokenBuckets)
  ) {
    throw new Error(`Mismatched ${prefix}.tokenBuckets in current evaluation partial report.`);
  }
  assertStringArray(entry.benchmarkFamilies, `${prefix}.benchmarkFamilies`);
  assertStringArray(entry.assessmentDimensions, `${prefix}.assessmentDimensions`);
  assertStringArray(entry.errors, `${prefix}.errors`);
  if (entry.promptCache !== undefined) {
    assertPromptCache(entry.promptCache, `${prefix}.promptCache`);
  }
  if (!isDeepStrictEqual(entry.promptCache, entry.usage.promptCache)) {
    throw new Error(`Mismatched ${prefix}.promptCache in current evaluation partial report.`);
  }
  if (entry.failedRubrics !== undefined) {
    if (!Array.isArray(entry.failedRubrics)) {
      throw new Error(`Invalid ${prefix}.failedRubrics in current evaluation partial report.`);
    }
    entry.failedRubrics.forEach((failure, failureIndex) => {
      const failurePath = `${prefix}.failedRubrics[${failureIndex}]`;
      assertExactFields(failure, failurePath, ['fixtureId'], ['detail']);
      if (
        typeof failure.fixtureId !== 'string' ||
        (failure.detail !== undefined && typeof failure.detail !== 'string')
      ) {
        throw new Error(`Invalid ${failurePath} in current evaluation partial report.`);
      }
    });
  }
  if (entry.trace !== undefined) {
    const projectedTrace = projectPublicRedactedTrace(entry.trace);
    if (!projectedTrace) {
      throw new Error(`Invalid ${prefix}.trace in current evaluation partial report.`);
    }
  }
  if (entry.detail !== undefined && typeof entry.detail !== 'string') {
    throw new Error(`Invalid ${prefix}.detail in current evaluation partial report.`);
  }
  for (const field of ['rubricPassed', 'rubricTotal']) {
    if (entry[field] !== undefined) {
      assertFiniteNumber(entry[field], `${prefix}.${field}`, { integer: true });
    }
  }
  return entry;
}

function parsePartialReport(value) {
  if (!isRecord(value)) {
    throw new Error('Evaluation partial report must be a current versioned envelope.');
  }
  const fields = Object.keys(value).sort();
  if (fields.length !== 2 || fields[0] !== 'entries' || fields[1] !== 'schemaVersion') {
    throw new Error('Evaluation partial report contains unknown or missing envelope fields.');
  }
  if (value.schemaVersion !== PARTIAL_REPORT_SCHEMA_VERSION) {
    throw new Error('Unsupported evaluation partial report schema; legacy data is not accepted.');
  }
  if (!Array.isArray(value.entries)) {
    throw new Error('Evaluation partial report entries must be an array.');
  }
  return {
    schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
    entries: value.entries.map(assertScenarioEntry),
  };
}

function readPartialReportFile(partialPath) {
  if (!fs.existsSync(partialPath)) {
    return { schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION, entries: [] };
  }
  const raw = fs.readFileSync(partialPath, 'utf8');
  if (raw.trim().length === 0) {
    throw new Error('Evaluation partial report is empty and cannot be treated as current data.');
  }
  return parsePartialReport(JSON.parse(raw));
}

function writePartialReportFile(partialPath, entries) {
  const envelope = parsePartialReport({
    schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
    entries,
  });
  atomicWriteFileSync(partialPath, JSON.stringify(envelope, null, 2), 'utf8');
}

module.exports = {
  PARTIAL_REPORT_SCHEMA_VERSION,
  SCENARIO_ENTRY_SCHEMA_VERSION,
  assertScenarioEntry,
  parsePartialReport,
  readPartialReportFile,
  writePartialReportFile,
};
