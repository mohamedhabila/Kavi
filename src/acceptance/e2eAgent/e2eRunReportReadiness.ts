import type { E2EAssessmentReport } from './e2eAssessmentReport';
import type { E2EAssessmentDimension } from './e2eAssessmentDimensions';
import { safeRate } from './e2eRunReportMath';
import type {
  E2ERunReportCacheSummary,
  E2ERunReportGraderAudit,
  E2ERunReportReadiness,
  E2ERunReportReliability,
  E2ERunReportScenarioEntry,
} from './e2eRunReport';
import {
  E2E_READINESS_MIN_AXIS_PASS_RATE,
  E2E_READINESS_MIN_FAST_SUITE_SCENARIO_COUNT,
  E2E_READINESS_MIN_PASS_RATE,
} from './thresholds';

const CRITICAL_READINESS_DIMENSIONS = new Set<E2EAssessmentDimension>([
  'tool_discovery',
  'memory',
  'control_graph',
  'mobile_native',
  'privacy_safety',
]);

export function buildGraderAudit(
  entries: ReadonlyArray<E2ERunReportScenarioEntry>,
): E2ERunReportGraderAudit {
  const missingRubricAuditScenarioIds = entries
    .filter((entry) => !entry.rubricAudit)
    .map((entry) => entry.fixtureId);
  const auditedEntries = entries.filter((entry) => entry.rubricAudit);
  const risks = auditedEntries.flatMap((entry) => entry.rubricAudit.risks);
  const totals = auditedEntries.reduce(
    (acc, entry) => ({
      rubricCount: acc.rubricCount + entry.rubricAudit.rubricCount,
      assistantProseRubricCount:
        acc.assistantProseRubricCount + entry.rubricAudit.assistantProseRubricCount,
      weakPatternRubricCount: acc.weakPatternRubricCount + entry.rubricAudit.weakPatternRubricCount,
      structuralSubstringRubricCount:
        acc.structuralSubstringRubricCount + entry.rubricAudit.structuralSubstringRubricCount,
    }),
    {
      rubricCount: 0,
      assistantProseRubricCount: 0,
      weakPatternRubricCount: 0,
      structuralSubstringRubricCount: 0,
    },
  );

  return {
    scenarioCount: entries.length,
    auditedScenarioCount: auditedEntries.length,
    ...totals,
    missingRubricAuditScenarioIds,
    risks,
    passing:
      missingRubricAuditScenarioIds.length === 0 &&
      totals.assistantProseRubricCount === 0 &&
      totals.weakPatternRubricCount === 0,
  };
}

export function buildReliabilityReport(
  entries: ReadonlyArray<E2ERunReportScenarioEntry>,
  maxScenarioRetries: number,
): E2ERunReportReliability {
  const k = Math.max(1, maxScenarioRetries + 1);
  const scenarios = entries.map((entry) => {
    const attemptCount = Math.max(1, entry.attemptCount);
    return {
      fixtureId: entry.fixtureId,
      passed: entry.passed,
      attemptCount,
      k,
      passAt1: entry.passed && attemptCount === 1,
      passAtK: entry.passed && attemptCount <= k,
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

export function buildReadinessReport(params: {
  entries: ReadonlyArray<E2ERunReportScenarioEntry>;
  assessment: E2EAssessmentReport;
  cache: E2ERunReportCacheSummary;
  graderAudit: E2ERunReportGraderAudit;
  reliability: E2ERunReportReliability;
}): E2ERunReportReadiness {
  const criticalFailedScenarioIds = params.entries
    .filter(
      (entry) =>
        !entry.passed &&
        entry.assessmentDimensions.some((dimension) => CRITICAL_READINESS_DIMENSIONS.has(dimension)),
    )
    .map((entry) => entry.fixtureId)
    .sort();
  const failedCriteria: string[] = [];

  if (params.entries.length < E2E_READINESS_MIN_FAST_SUITE_SCENARIO_COUNT) {
    failedCriteria.push('scenario_coverage');
  }
  if (params.assessment.overallScenarioPassRate < E2E_READINESS_MIN_PASS_RATE) {
    failedCriteria.push('scenario_pass_rate');
  }
  if (params.reliability.pass1Rate < E2E_READINESS_MIN_PASS_RATE) {
    failedCriteria.push('pass1_reliability');
  }
  if (
    params.assessment.dimensions.length === 0 ||
    params.assessment.benchmarkFamilies.length === 0
  ) {
    failedCriteria.push('assessment_axis_coverage');
  }
  if (
    params.assessment.dimensions.some(
      (dimension) => dimension.passRate < E2E_READINESS_MIN_AXIS_PASS_RATE,
    )
  ) {
    failedCriteria.push('dimension_pass_rates');
  }
  if (
    params.assessment.benchmarkFamilies.some(
      (family) => family.passRate < E2E_READINESS_MIN_AXIS_PASS_RATE,
    )
  ) {
    failedCriteria.push('benchmark_family_pass_rates');
  }
  if (criticalFailedScenarioIds.length > 0) {
    failedCriteria.push('critical_dimension_failures');
  }
  if (!params.cache.passing) {
    failedCriteria.push('cache_readiness');
  }
  if (params.cache.eligibleInputTokens > 0 && !params.cache.cacheCreateTelemetryAvailable) {
    failedCriteria.push('cache_create_telemetry');
  }
  if (!params.graderAudit.passing) {
    failedCriteria.push('grader_audit');
  }
  if (params.entries.some((entry) => !entry.loopDiagnostics.passing)) {
    failedCriteria.push('loop_diagnostics');
  }

  return {
    passing: failedCriteria.length === 0,
    targetScenarioCount: E2E_READINESS_MIN_FAST_SUITE_SCENARIO_COUNT,
    targetScenarioPassRate: E2E_READINESS_MIN_PASS_RATE,
    targetAxisPassRate: E2E_READINESS_MIN_AXIS_PASS_RATE,
    scenarioPassRate: params.assessment.overallScenarioPassRate,
    pass1Rate: params.reliability.pass1Rate,
    passKRate: params.reliability.passKRate,
    cacheEligibleReadRate: params.cache.eligibleCacheReadRate,
    cachePassing: params.cache.passing,
    graderAuditPassing: params.graderAudit.passing,
    criticalFailureCount: criticalFailedScenarioIds.length,
    criticalFailedScenarioIds,
    failedCriteria,
  };
}
