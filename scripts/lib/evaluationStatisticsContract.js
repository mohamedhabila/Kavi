const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const { loadEvaluationSchema } = require('./evaluationContract');
const { wilson95 } = require('./evaluationStatisticsMath');

const EVALUATION_STATISTICS_SCHEMA_URL =
  'https://raw.githubusercontent.com/mohamedhabila/Kavi/main/evaluation/statistics.schema.json';
const EVALUATION_STATISTICS_SCHEMA_FILE = path.join('evaluation', 'statistics.schema.json');

function loadEvaluationStatisticsSchema(projectRoot) {
  return JSON.parse(
    fs.readFileSync(path.join(projectRoot, EVALUATION_STATISTICS_SCHEMA_FILE), 'utf8'),
  );
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

function buildStatisticsValidator(evaluationSchema, statisticsSchema, definitionName) {
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: true,
  });
  addFormats(ajv);
  ajv.addSchema(evaluationSchema);
  ajv.addSchema(statisticsSchema);
  const validator = ajv.getSchema(`${statisticsSchema.$id}#/$defs/${definitionName}`);
  if (!validator) throw new Error(`Missing evaluation statistics definition: ${definitionName}`);
  return validator;
}

function validateStatisticsDefinition(
  value,
  evaluationSchema,
  statisticsSchema,
  definitionName,
  root,
) {
  try {
    const validator = buildStatisticsValidator(evaluationSchema, statisticsSchema, definitionName);
    if (validator(value)) return [];
    return (validator.errors ?? []).map(
      (error) => `${formatInstancePath(error.instancePath, root)}: ${error.message}`,
    );
  } catch (error) {
    return [
      `statisticsSchema.$defs.${definitionName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ];
  }
}

function validateEvaluationTrialSet(value, evaluationSchema, statisticsSchema) {
  return validateStatisticsDefinition(
    value,
    evaluationSchema,
    statisticsSchema,
    'trialSet',
    'input',
  );
}

function validateEvaluationStatisticsReport(value, evaluationSchema, statisticsSchema) {
  const failures = validateStatisticsDefinition(
    value,
    evaluationSchema,
    statisticsSchema,
    'statisticsReport',
    'report',
  );
  validateStatisticsReportSemantics(value, evaluationSchema, statisticsSchema, failures);
  return Array.from(new Set(failures));
}

function numbersClose(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-12;
}

function validateBinaryMetric(metric, location, failures) {
  if (!metric || typeof metric !== 'object' || Array.isArray(metric)) return;
  const invalidCount =
    Number.isSafeInteger(metric.passed) &&
    Number.isSafeInteger(metric.total) &&
    metric.passed > metric.total;
  if (invalidCount) {
    failures.push(`${location}.passed: must not exceed total`);
  }
  if (!Number.isSafeInteger(metric.total) || !Number.isSafeInteger(metric.passed)) return;
  if (metric.total < 0 || metric.passed < 0) return;
  if (metric.total === 0) {
    if (metric.rate !== null || metric.wilson95 !== null) {
      failures.push(`${location}: zero denominator requires null rate and Wilson interval`);
    }
    return;
  }
  if (!numbersClose(metric.rate, metric.passed / metric.total)) {
    failures.push(`${location}.rate: must equal passed divided by total`);
  }
  if (invalidCount) return;
  const expected = wilson95(metric.passed, metric.total);
  if (
    !metric.wilson95 ||
    !numbersClose(metric.wilson95.low, expected.low) ||
    !numbersClose(metric.wilson95.high, expected.high) ||
    metric.wilson95.low > metric.wilson95.high
  ) {
    failures.push(`${location}.wilson95: must be the canonical Wilson 95% interval`);
  }
}

function validateMetricSet(metrics, location, maximumTotal, failures) {
  for (const metricName of ['passAt1', 'passAtK', 'allPass']) {
    validateBinaryMetric(metrics?.[metricName], `${location}.${metricName}`, failures);
  }
  const totals = ['passAt1', 'passAtK', 'allPass'].map(
    (metricName) => metrics?.[metricName]?.total,
  );
  if (totals.every(Number.isSafeInteger) && new Set(totals).size !== 1) {
    failures.push(`${location}: reliability metrics must use one resolved-scenario denominator`);
  }
  if (Number.isSafeInteger(maximumTotal) && totals.some((total) => total > maximumTotal)) {
    failures.push(`${location}: resolved denominator must not exceed scenarioCount`);
  }
  if (
    Number.isSafeInteger(metrics?.passAt1?.passed) &&
    Number.isSafeInteger(metrics?.passAtK?.passed) &&
    metrics.passAtK.passed < metrics.passAt1.passed
  ) {
    failures.push(`${location}.passAtK.passed: must not be below passAt1`);
  }
  if (
    Number.isSafeInteger(metrics?.allPass?.passed) &&
    Number.isSafeInteger(metrics?.passAt1?.passed) &&
    metrics.allPass.passed > metrics.passAt1.passed
  ) {
    failures.push(`${location}.allPass.passed: must not exceed passAt1`);
  }
}

function validateDelta(delta, location, failures) {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return;
  if (delta.mean === null) {
    if (delta.bootstrap95 !== null) {
      failures.push(`${location}: null mean requires a null bootstrap interval`);
    }
    return;
  }
  if (
    !delta.bootstrap95 ||
    delta.bootstrap95.low > delta.bootstrap95.high ||
    delta.bootstrap95.low < -1 ||
    delta.bootstrap95.high > 1
  ) {
    failures.push(`${location}.bootstrap95: must be an ordered bounded delta interval`);
  }
}

function validateSortedUniqueIds(entries, field, location, failures) {
  if (!Array.isArray(entries)) return;
  const values = entries.map((entry) => entry?.[field]);
  if (new Set(values).size !== values.length) {
    failures.push(`${location}: must contain unique ${field} values`);
  }
  const sorted = [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (values.some((value, index) => value !== sorted[index])) {
    failures.push(`${location}: must be sorted by ${field}`);
  }
}

function validateStatisticsReportSemantics(report, evaluationSchema, statisticsSchema, failures) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return;
  if (report?.reliabilityConfig?.k > report?.reliabilityConfig?.trialCount) {
    failures.push('report.reliabilityConfig.k: must not exceed trialCount');
  }
  const eligibilityOrder = statisticsSchema?.$defs?.eligibilityFailure?.enum ?? [];
  const eligibility = Array.isArray(report.eligibilityFailures) ? report.eligibilityFailures : [];
  const sortedEligibility = eligibilityOrder.filter((entry) => eligibility.includes(entry));
  if (
    eligibility.length !== sortedEligibility.length ||
    eligibility.some((entry, index) => entry !== sortedEligibility[index])
  ) {
    failures.push('report.eligibilityFailures: must be unique and canonically sorted');
  }
  if (report.claimEligible !== (eligibility.length === 0)) {
    failures.push('report.claimEligible: must equal absence of eligibility failures');
  }
  const evidenceEligibility = [
    ['missingTrialCount', 'missing_trial'],
    ['duplicateTrialCount', 'duplicate_trial'],
    ['seedMismatchCount', 'seed_mismatch'],
    ['skippedCount', 'skipped_evidence'],
    ['ambiguousCount', 'ambiguous_evidence'],
    ['infrastructureErrorCount', 'infrastructure_error'],
  ];
  for (const [countField, failureCode] of evidenceEligibility) {
    if (report?.evidence?.[countField] > 0 && !eligibility.includes(failureCode)) {
      failures.push(
        `report.eligibilityFailures: must include ${failureCode} when ${countField} is non-zero`,
      );
    }
  }
  const expectedScenarioCount =
    Number.isSafeInteger(report?.evidence?.expectedTrialCount) &&
    Number.isSafeInteger(report?.reliabilityConfig?.trialCount) &&
    report.reliabilityConfig.trialCount > 0 &&
    report.evidence.expectedTrialCount % report.reliabilityConfig.trialCount === 0
      ? report.evidence.expectedTrialCount / report.reliabilityConfig.trialCount
      : undefined;
  validateMetricSet(report.overall, 'report.overall', expectedScenarioCount, failures);
  validateSortedUniqueIds(report.families, 'family', 'report.families', failures);
  for (const [index, family] of (Array.isArray(report.families) ? report.families : []).entries()) {
    validateMetricSet(
      family?.metrics,
      `report.families[${index}].metrics`,
      family?.scenarioCount,
      failures,
    );
  }

  const categories = evaluationSchema?.$defs?.failureCategory?.enum ?? [];
  const observedCategories = Array.isArray(report.failureTaxonomy)
    ? report.failureTaxonomy.map((entry) => entry?.category)
    : [];
  if (
    observedCategories.length !== categories.length ||
    observedCategories.some((category, index) => category !== categories[index])
  ) {
    failures.push('report.failureTaxonomy: must exactly match the canonical failure taxonomy');
  }
  validateSortedUniqueIds(report.safety, 'id', 'report.safety', failures);
  for (const [index, safety] of (Array.isArray(report.safety) ? report.safety : []).entries()) {
    if (safety?.invariantSatisfied !== (safety?.failed === 0 && safety?.notEvaluated === 0)) {
      failures.push(
        `report.safety[${index}].invariantSatisfied: must reflect failures and missing evidence`,
      );
    }
    if (safety?.failed > 0 && !eligibility.includes('safety_invariant_failure')) {
      failures.push(
        'report.eligibilityFailures: must include safety_invariant_failure for failed safety evidence',
      );
    }
    if (safety?.notEvaluated > 0 && !eligibility.includes('safety_invariant_missing')) {
      failures.push(
        'report.eligibilityFailures: must include safety_invariant_missing for unevaluated safety evidence',
      );
    }
  }

  const paired = report.paired;
  if (paired && typeof paired === 'object' && !Array.isArray(paired)) {
    if (paired.qualifiedPairCount > paired.resolvedPairCount) {
      failures.push('report.paired.qualifiedPairCount: must not exceed resolvedPairCount');
    }
    const unqualifiedPairCount = paired.resolvedPairCount - paired.qualifiedPairCount;
    if (
      Number.isSafeInteger(unqualifiedPairCount) &&
      (paired.accidentalEndpointCount < unqualifiedPairCount * 2 ||
        paired.accidentalEndpointCount > unqualifiedPairCount * 2 + paired.qualifiedPairCount)
    ) {
      failures.push(
        'report.paired.accidentalEndpointCount: must match the unqualified resolved pairs',
      );
    }
    const structurallyValid =
      paired.resolvedPairCount === paired.expectedPairCount && paired.unresolvedPairCount === 0;
    const allPairCountsZero =
      paired.expectedPairCount === 0 &&
      paired.resolvedPairCount === 0 &&
      paired.qualifiedPairCount === 0 &&
      paired.accidentalEndpointCount === 0 &&
      paired.unresolvedPairCount === 0;
    const expectedStatus = allPairCountsZero
      ? 'not_requested'
      : paired.expectedPairCount > 0
        ? structurallyValid
          ? 'valid'
          : 'invalid'
        : null;
    if (paired.status !== expectedStatus) {
      failures.push('report.paired.status: must match the aggregate pair counts');
    }
    if (
      paired.status === 'not_requested' &&
      (paired.expectedPairCount !== 0 ||
        paired.resolvedPairCount !== 0 ||
        paired.qualifiedPairCount !== 0 ||
        paired.accidentalEndpointCount !== 0 ||
        paired.unresolvedPairCount !== 0)
    ) {
      failures.push('report.paired.status: not_requested requires zero pair counts');
    }
    if (
      (paired.candidateOnlyPassCount > paired.qualifiedPairCount ||
        paired.referenceOnlyPassCount > paired.qualifiedPairCount ||
        paired.candidateOnlyPassCount + paired.referenceOnlyPassCount >
          paired.qualifiedPairCount) &&
      Number.isSafeInteger(paired.qualifiedPairCount)
    ) {
      failures.push('report.paired: qualified pass diagnostics must not exceed qualified pairs');
    }
    if (paired.status === 'invalid' && !eligibility.includes('invalid_pair_evidence')) {
      failures.push(
        'report.eligibilityFailures: must include invalid_pair_evidence for invalid paired evidence',
      );
    }
    if (
      paired.status === 'not_requested' &&
      (paired?.taskDelta?.mean !== null ||
        paired?.taskDelta?.bootstrap95 !== null ||
        paired?.rubricDelta?.mean !== null ||
        paired?.rubricDelta?.bootstrap95 !== null)
    ) {
      failures.push('report.paired.status: not_requested requires null paired deltas');
    }
    validateDelta(paired.taskDelta, 'report.paired.taskDelta', failures);
    validateDelta(paired.rubricDelta, 'report.paired.rubricDelta', failures);
  }
}

function checkPublicEvaluationStatisticsContract(projectRoot) {
  let evaluationSchema;
  let statisticsSchema;
  try {
    evaluationSchema = loadEvaluationSchema(projectRoot);
    statisticsSchema = loadEvaluationStatisticsSchema(projectRoot);
  } catch (error) {
    return [
      `${EVALUATION_STATISTICS_SCHEMA_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  const failures = [];
  if (statisticsSchema?.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    failures.push('statisticsSchema.$schema: must use JSON Schema draft 2020-12');
  }
  if (statisticsSchema?.$id !== EVALUATION_STATISTICS_SCHEMA_URL) {
    failures.push(`statisticsSchema.$id: must be ${EVALUATION_STATISTICS_SCHEMA_URL}`);
  }
  for (const definitionName of ['trialSet', 'statisticsReport']) {
    if (!statisticsSchema?.$defs?.[definitionName]) {
      failures.push(`statisticsSchema.$defs.${definitionName}: is required`);
    }
    if (
      !(statisticsSchema?.oneOf ?? []).some((entry) => entry?.$ref === `#/$defs/${definitionName}`)
    ) {
      failures.push(`statisticsSchema.oneOf: must include #/$defs/${definitionName}`);
    }
    try {
      buildStatisticsValidator(evaluationSchema, statisticsSchema, definitionName);
    } catch (error) {
      failures.push(
        `statisticsSchema.$defs.${definitionName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return failures;
}

module.exports = {
  EVALUATION_STATISTICS_SCHEMA_FILE,
  EVALUATION_STATISTICS_SCHEMA_URL,
  checkPublicEvaluationStatisticsContract,
  loadEvaluationStatisticsSchema,
  validateEvaluationStatisticsReport,
  validateEvaluationTrialSet,
};
