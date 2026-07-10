const fs = require('fs');

const { atomicWriteFileSync } = require('./fileTransaction');

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
    assertFiniteNumber(entry[field], `${prefix}.${field}`, { integer: true });
  }
  if (entry.graphStatus !== null && typeof entry.graphStatus !== 'string') {
    throw new Error(`Invalid ${prefix}.graphStatus in current evaluation partial report.`);
  }
  for (const field of ['usage', 'tokenBuckets', 'cache', 'loopDiagnostics', 'rubricAudit']) {
    if (!isRecord(entry[field])) {
      throw new Error(`Invalid ${prefix}.${field} in current evaluation partial report.`);
    }
  }
  assertStringArray(entry.benchmarkFamilies, `${prefix}.benchmarkFamilies`);
  assertStringArray(entry.assessmentDimensions, `${prefix}.assessmentDimensions`);
  assertStringArray(entry.errors, `${prefix}.errors`);
  if (entry.promptCache !== undefined && !isRecord(entry.promptCache)) {
    throw new Error(`Invalid ${prefix}.promptCache in current evaluation partial report.`);
  }
  if (entry.failedRubrics !== undefined && !Array.isArray(entry.failedRubrics)) {
    throw new Error(`Invalid ${prefix}.failedRubrics in current evaluation partial report.`);
  }
  if (
    entry.trace !== undefined &&
    (!isRecord(entry.trace) || entry.trace.schemaVersion !== 'e2e-redacted-trace-v2')
  ) {
    throw new Error(`Invalid ${prefix}.trace in current evaluation partial report.`);
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
