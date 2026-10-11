const { FAILURE_CATEGORIES: FAILURE_CATEGORY_LIST, RUBRIC_KINDS } = require('./constants');

const MAX_PUBLIC_ITEMS = 1024;
const CONTENT_CLASSES = new Set(['private', 'synthetic_public']);

const {
  E2E_ASSESSMENT_DIMENSION_LABELS,
} = require('../../src/acceptance/e2eAgent/e2eAssessmentDimensions.ts');
const {
  E2E_BENCHMARK_FAMILY_META,
} = require('../../src/acceptance/e2eAgent/e2eBenchmarkRegistry.ts');

const ASSESSMENT_DIMENSION_PUBLIC_META = E2E_ASSESSMENT_DIMENSION_LABELS;
const BENCHMARK_FAMILY_PUBLIC_META = Object.freeze(
  Object.fromEntries(
    Object.entries(E2E_BENCHMARK_FAMILY_META).map(([id, meta]) => [
      id,
      { label: meta.label, externalReference: meta.externalReference },
    ]),
  ),
);

const ASSESSMENT_DIMENSIONS = new Set(Object.keys(ASSESSMENT_DIMENSION_PUBLIC_META));
const BENCHMARK_FAMILIES = new Set(Object.keys(BENCHMARK_FAMILY_PUBLIC_META));

const PUBLIC_EVALUATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/ -]{0,255}$/u;

function isPublicEvaluationId(value) {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    !PUBLIC_EVALUATION_ID_PATTERN.test(value) ||
    value.includes('//')
  ) {
    return false;
  }
  return value.split('/').every((segment) => segment !== '.' && segment !== '..');
}

const TURN_COMPLETION_FIELDS = new Set(['execution', 'final_response', 'agent_run']);

const GRAPH_STATUSES = new Set([
  'ready',
  'model_turn',
  'awaiting_tool_results',
  'recovering',
  'waiting_async',
  'awaiting_user',
  'awaiting_review',
  'blocked',
  'finalized',
  'yielded',
  'cancelled',
  'failed',
]);

const FAILURE_CATEGORIES = new Set(FAILURE_CATEGORY_LIST);

const READINESS_CRITERIA = new Set([
  'scenario_coverage',
  'scenario_pass_rate',
  'pass1_reliability',
  'assessment_axis_coverage',
  'dimension_pass_rates',
  'benchmark_family_pass_rates',
  'critical_dimension_failures',
  'cache_readiness',
  'cache_create_telemetry',
  'grader_audit',
  'loop_diagnostics',
]);

module.exports = {
  ASSESSMENT_DIMENSION_PUBLIC_META,
  ASSESSMENT_DIMENSIONS,
  BENCHMARK_FAMILY_PUBLIC_META,
  BENCHMARK_FAMILIES,
  CONTENT_CLASSES,
  FAILURE_CATEGORIES,
  GRAPH_STATUSES,
  isPublicEvaluationId,
  MAX_PUBLIC_ITEMS,
  PUBLIC_EVALUATION_ID_PATTERN,
  READINESS_CRITERIA,
  RUBRIC_KINDS,
  TURN_COMPLETION_FIELDS,
};
