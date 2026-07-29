const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const { mean } = require('./evaluationStatisticsMath');

const INTENT_FRAME_SCHEMA_URL =
  'https://raw.githubusercontent.com/mohamedhabila/Kavi/main/evaluation/intent-frame.schema.json';
const INTENT_FRAME_SCHEMA_FILE = path.join('evaluation', 'intent-frame.schema.json');
const INTENT_FRAME_FIELDS = Object.freeze([
  'goal',
  'entities',
  'constraints',
  'preferences',
  'missingInformation',
  'requestedAction',
  'requestedMode',
  'approvalRisk',
  'temporalRequirements',
  'successCriteria',
]);
const INTENT_FRAME_ELIGIBILITY_FAILURES = Object.freeze([
  'invalid_contract',
  'invalid_configuration',
  'candidate_digest_mismatch',
  'gold_digest_mismatch',
  'duplicate_case',
  'invalid_none_atom',
  'incomplete_field_coverage',
]);

function loadIntentFrameSchema(projectRoot) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, INTENT_FRAME_SCHEMA_FILE), 'utf8'));
}

function formatInstancePath(instancePath, root) {
  return instancePath
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'))
    .reduce(
      (location, segment) =>
        /^[0-9]+$/u.test(segment) ? `${location}[${segment}]` : `${location}.${segment}`,
      root,
    );
}

function buildIntentFrameValidator(schema, definitionName) {
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: true,
  });
  addFormats(ajv);
  ajv.addSchema(schema);
  const validator = ajv.getSchema(`${schema.$id}#/$defs/${definitionName}`);
  if (!validator) throw new Error(`Missing intent-frame definition: ${definitionName}`);
  return validator;
}

function validateIntentFrameDefinition(value, schema, definitionName, root) {
  try {
    const validator = buildIntentFrameValidator(schema, definitionName);
    if (validator(value)) return [];
    return (validator.errors ?? []).map(
      (error) => `${formatInstancePath(error.instancePath, root)}: ${error.message}`,
    );
  } catch (error) {
    return [
      `intentFrameSchema.$defs.${definitionName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ];
  }
}

function validateIntentFrameInput(value, schema) {
  return validateIntentFrameDefinition(value, schema, 'intentFrameInput', 'input');
}

function numbersClose(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-12;
}

function canonicalRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function validateFieldScore(field, index, cases, failures) {
  const location = `report.fields[${index}]`;
  if (field?.field !== INTENT_FRAME_FIELDS[index]) {
    failures.push(`${location}.field: must preserve the canonical intent-frame order`);
  }
  if (
    Number.isSafeInteger(field?.scorable) &&
    Number.isSafeInteger(field?.ambiguous) &&
    Number.isSafeInteger(field?.unscorable) &&
    field.scorable + field.ambiguous + field.unscorable !== cases
  ) {
    failures.push(`${location}: evidence-status counts must sum to the case count`);
  }
  const expectedCoverage = cases > 0 ? field?.scorable / cases : null;
  if (
    expectedCoverage === null
      ? field?.coverageRate !== null
      : !numbersClose(field?.coverageRate, expectedCoverage)
  ) {
    failures.push(`${location}.coverageRate: must equal scorable evidence divided by cases`);
  }
  if (field?.scorable === 0) {
    if (
      field.truePositive !== 0 ||
      field.falsePositive !== 0 ||
      field.falseNegative !== 0 ||
      field.precision !== null ||
      field.recall !== null ||
      field.f1 !== null
    ) {
      failures.push(
        `${location}: no scorable evidence requires zero confusion counts and null rates`,
      );
    }
    return;
  }
  if (
    !Number.isSafeInteger(field?.truePositive) ||
    !Number.isSafeInteger(field?.falsePositive) ||
    !Number.isSafeInteger(field?.falseNegative)
  ) {
    return;
  }
  const expectedPrecision = canonicalRate(
    field.truePositive,
    field.truePositive + field.falsePositive,
  );
  const expectedRecall = canonicalRate(
    field.truePositive,
    field.truePositive + field.falseNegative,
  );
  const expectedF1 = canonicalRate(
    2 * field.truePositive,
    2 * field.truePositive + field.falsePositive + field.falseNegative,
  );
  for (const [metric, expected] of [
    ['precision', expectedPrecision],
    ['recall', expectedRecall],
    ['f1', expectedF1],
  ]) {
    if (expected === null ? field[metric] !== null : !numbersClose(field[metric], expected)) {
      failures.push(`${location}.${metric}: must equal the canonical confusion-count rate`);
    }
  }
}

function validateCoverage(entries, location, cases, failures) {
  if (!Array.isArray(entries)) return;
  const ids = entries.map((entry) => entry?.id);
  const sorted = [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (new Set(ids).size !== ids.length || ids.some((id, index) => id !== sorted[index])) {
    failures.push(`${location}: must contain unique entries sorted by id`);
  }
  const total = entries.reduce(
    (sum, entry) => sum + (Number.isSafeInteger(entry?.caseCount) ? entry.caseCount : 0),
    0,
  );
  if (total !== cases) failures.push(`${location}: case counts must sum to the report case count`);
}

function validateIntentFrameReportSemantics(report, failures) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return;
  const eligibility = Array.isArray(report.eligibilityFailures) ? report.eligibilityFailures : [];
  const canonicalEligibility = INTENT_FRAME_ELIGIBILITY_FAILURES.filter((failure) =>
    eligibility.includes(failure),
  );
  if (
    eligibility.length !== canonicalEligibility.length ||
    eligibility.some((failure, index) => failure !== canonicalEligibility[index])
  ) {
    failures.push('report.eligibilityFailures: must be unique and canonically sorted');
  }
  if (report.claimEligible !== (eligibility.length === 0)) {
    failures.push('report.claimEligible: must equal absence of eligibility failures');
  }

  const cases = Number.isSafeInteger(report?.counts?.cases) ? report.counts.cases : 0;
  const fieldLabels = cases * INTENT_FRAME_FIELDS.length;
  if (report?.counts?.fieldLabels !== fieldLabels) {
    failures.push('report.counts.fieldLabels: must equal cases times the closed field count');
  }
  const statusTotal =
    (report?.counts?.scorable ?? 0) +
    (report?.counts?.ambiguous ?? 0) +
    (report?.counts?.unscorable ?? 0);
  if (statusTotal !== report?.counts?.fieldLabels) {
    failures.push('report.counts: evidence-status counts must sum to fieldLabels');
  }

  const fields = Array.isArray(report.fields) ? report.fields : [];
  for (const [index, field] of fields.entries()) {
    validateFieldScore(field, index, cases, failures);
  }
  const aggregateCounts = fields.reduce(
    (counts, field) => ({
      scorable: counts.scorable + (field?.scorable ?? 0),
      ambiguous: counts.ambiguous + (field?.ambiguous ?? 0),
      unscorable: counts.unscorable + (field?.unscorable ?? 0),
    }),
    { scorable: 0, ambiguous: 0, unscorable: 0 },
  );
  for (const status of ['scorable', 'ambiguous', 'unscorable']) {
    if (aggregateCounts[status] !== report?.counts?.[status]) {
      failures.push(`report.counts.${status}: must equal the sum of field evidence counts`);
    }
  }
  const scorableF1 = fields
    .filter((field) => field?.scorable > 0 && Number.isFinite(field?.f1))
    .map((field) => field.f1);
  const expectedMacroF1 = mean(scorableF1);
  if (
    expectedMacroF1 === null
      ? report.macroF1 !== null
      : !numbersClose(report.macroF1, expectedMacroF1)
  ) {
    failures.push('report.macroF1: must be the unweighted mean of scorable field F1 values');
  }
  const minimumCoverage = report?.evaluator?.minimumScorableCoverage;
  const hasIncompleteField = fields.some(
    (field) =>
      !Number.isFinite(field?.coverageRate) ||
      !Number.isFinite(minimumCoverage) ||
      field.coverageRate < minimumCoverage,
  );
  if (hasIncompleteField !== eligibility.includes('incomplete_field_coverage')) {
    failures.push(
      'report.eligibilityFailures: incomplete_field_coverage must reflect zero-scorable fields',
    );
  }

  validateCoverage(report?.coverage?.languages, 'report.coverage.languages', cases, failures);
  validateCoverage(report?.coverage?.productAreas, 'report.coverage.productAreas', cases, failures);
}

function validateIntentFrameReport(value, schema) {
  const failures = validateIntentFrameDefinition(value, schema, 'intentFrameReport', 'report');
  validateIntentFrameReportSemantics(value, failures);
  return [...new Set(failures)];
}

function checkPublicIntentFrameContract(projectRoot) {
  let schema;
  try {
    schema = loadIntentFrameSchema(projectRoot);
  } catch (error) {
    return [
      `${INTENT_FRAME_SCHEMA_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  const failures = [];
  if (schema?.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    failures.push('intentFrameSchema.$schema: must use JSON Schema draft 2020-12');
  }
  if (schema?.$id !== INTENT_FRAME_SCHEMA_URL) {
    failures.push(`intentFrameSchema.$id: must be ${INTENT_FRAME_SCHEMA_URL}`);
  }
  for (const definitionName of ['intentFrameInput', 'intentFrameReport']) {
    if (!schema?.$defs?.[definitionName]) {
      failures.push(`intentFrameSchema.$defs.${definitionName}: is required`);
    }
    if (!(schema?.oneOf ?? []).some((entry) => entry?.$ref === `#/$defs/${definitionName}`)) {
      failures.push(`intentFrameSchema.oneOf: must include #/$defs/${definitionName}`);
    }
    try {
      buildIntentFrameValidator(schema, definitionName);
    } catch (error) {
      failures.push(
        `intentFrameSchema.$defs.${definitionName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return failures;
}

module.exports = {
  INTENT_FRAME_ELIGIBILITY_FAILURES,
  INTENT_FRAME_FIELDS,
  INTENT_FRAME_SCHEMA_FILE,
  INTENT_FRAME_SCHEMA_URL,
  buildIntentFrameValidator,
  checkPublicIntentFrameContract,
  loadIntentFrameSchema,
  validateIntentFrameInput,
  validateIntentFrameReport,
};
