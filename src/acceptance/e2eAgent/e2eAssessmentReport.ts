// ---------------------------------------------------------------------------
// Kavi — E2E assessment report (dimensional + benchmark-family evidence)
// ---------------------------------------------------------------------------

import { buildPassRateSummary, isSummaryPassing } from '../acceptanceMetrics/aggregateResults';
import type { AcceptanceMetricSummary } from '../acceptanceMetrics/types';
import {
  E2E_ASSESSMENT_DIMENSION_LABELS,
  E2E_ASSESSMENT_MIN_DIMENSION_PASS_RATE,
  type E2EAssessmentDimension,
} from './e2eAssessmentDimensions';
import {
  E2E_BENCHMARK_FAMILY_META,
  E2E_BENCHMARK_FAMILIES,
  lookupE2EScenarioBenchmarkMeta,
  type E2EBenchmarkFamily,
} from './e2eBenchmarkRegistry';
import type { E2ERunReportScenarioEntry } from './e2eRunReport';

export type E2EAssessmentAxisSummary = {
  id: string;
  label: string;
  passed: number;
  total: number;
  passRate: number;
  targetPassRate: number;
  passing: boolean;
  scenarioIds: string[];
  failedScenarioIds: string[];
  externalReference?: string;
};

export type E2EAssessmentReport = {
  generatedAt: string;
  scenarioCount: number;
  overallScenarioPassRate: number;
  evidenceScore: number;
  dimensions: E2EAssessmentAxisSummary[];
  benchmarkFamilies: E2EAssessmentAxisSummary[];
  dimensionsPassing: boolean;
  benchmarkFamiliesPassing: boolean;
};

function groupAxisOutcomes(params: {
  entries: ReadonlyArray<E2ERunReportScenarioEntry>;
  resolveAxes: (scenarioId: string) => ReadonlyArray<string>;
  axisLabels: Readonly<Record<string, string>>;
  targetPassRate: number;
  externalReferences?: Readonly<Partial<Record<string, string>>>;
}): E2EAssessmentAxisSummary[] {
  const axisScenarioIds = new Map<string, Set<string>>();
  const axisFailedScenarioIds = new Map<string, Set<string>>();

  for (const entry of params.entries) {
    const axes = params.resolveAxes(entry.fixtureId);
    for (const axisId of axes) {
      if (!axisScenarioIds.has(axisId)) {
        axisScenarioIds.set(axisId, new Set());
        axisFailedScenarioIds.set(axisId, new Set());
      }
      axisScenarioIds.get(axisId)!.add(entry.fixtureId);
      if (!entry.passed) {
        axisFailedScenarioIds.get(axisId)!.add(entry.fixtureId);
      }
    }
  }

  return Array.from(axisScenarioIds.entries())
    .map(([axisId, scenarioIdSet]) => {
      const scenarioIds = Array.from(scenarioIdSet).sort();
      const failedScenarioIds = Array.from(axisFailedScenarioIds.get(axisId) ?? []).sort();
      const total = scenarioIds.length;
      const passed = total - failedScenarioIds.length;
      const passRate = total > 0 ? passed / total : 0;
      return {
        id: axisId,
        label: params.axisLabels[axisId] ?? axisId,
        passed,
        total,
        passRate,
        targetPassRate: params.targetPassRate,
        passing: passRate >= params.targetPassRate,
        scenarioIds,
        failedScenarioIds,
        ...(params.externalReferences?.[axisId]
          ? { externalReference: params.externalReferences[axisId] }
          : {}),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function buildE2EAssessmentReport(
  entries: ReadonlyArray<E2ERunReportScenarioEntry>,
  options?: { generatedAt?: string },
): E2EAssessmentReport {
  const scenarioCount = entries.length;
  const passedCount = entries.filter((entry) => entry.passed).length;
  const overallScenarioPassRate = scenarioCount > 0 ? passedCount / scenarioCount : 0;

  const dimensions = groupAxisOutcomes({
    entries,
    resolveAxes: (scenarioId) => lookupE2EScenarioBenchmarkMeta(scenarioId).assessmentDimensions,
    axisLabels: E2E_ASSESSMENT_DIMENSION_LABELS,
    targetPassRate: E2E_ASSESSMENT_MIN_DIMENSION_PASS_RATE,
  });

  const benchmarkFamilies = groupAxisOutcomes({
    entries,
    resolveAxes: (scenarioId) => lookupE2EScenarioBenchmarkMeta(scenarioId).benchmarkFamilies,
    axisLabels: Object.fromEntries(
      E2E_BENCHMARK_FAMILIES.map((family) => [family, E2E_BENCHMARK_FAMILY_META[family].label]),
    ),
    targetPassRate: E2E_ASSESSMENT_MIN_DIMENSION_PASS_RATE,
    externalReferences: Object.fromEntries(
      E2E_BENCHMARK_FAMILIES.map((family) => [
        family,
        E2E_BENCHMARK_FAMILY_META[family].externalReference,
      ]),
    ),
  });

  const dimensionRates = dimensions.map((summary) => summary.passRate);
  const familyRates = benchmarkFamilies.map((summary) => summary.passRate);
  const evidenceScore =
    dimensionRates.length + familyRates.length > 0
      ? [...dimensionRates, ...familyRates].reduce((sum, rate) => sum + rate, 0) /
        (dimensionRates.length + familyRates.length)
      : overallScenarioPassRate;

  const dimensionsPassing = dimensions.every((summary) => summary.passing);
  const benchmarkFamiliesPassing = benchmarkFamilies.every((summary) => summary.passing);

  return {
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    scenarioCount,
    overallScenarioPassRate,
    evidenceScore,
    dimensions,
    benchmarkFamilies,
    dimensionsPassing,
    benchmarkFamiliesPassing,
  };
}

export function buildE2EAssessmentDimensionSummaries(
  entries: ReadonlyArray<E2ERunReportScenarioEntry>,
): AcceptanceMetricSummary[] {
  const report = buildE2EAssessmentReport(entries);
  return report.dimensions.map((dimension) =>
    buildPassRateSummary({
      metricId: `e2e-assessment-dimension:${dimension.id}`,
      label: dimension.label,
      outcomes: dimension.scenarioIds.map((scenarioId) => ({
        fixtureId: scenarioId,
        passed: !dimension.failedScenarioIds.includes(scenarioId),
      })),
      targetRate: E2E_ASSESSMENT_MIN_DIMENSION_PASS_RATE,
      comparator: 'min',
    }),
  );
}

export function buildE2EBenchmarkFamilySummaries(
  entries: ReadonlyArray<E2ERunReportScenarioEntry>,
): AcceptanceMetricSummary[] {
  const report = buildE2EAssessmentReport(entries);
  return report.benchmarkFamilies.map((family) =>
    buildPassRateSummary({
      metricId: `e2e-benchmark-family:${family.id}`,
      label: family.label,
      outcomes: family.scenarioIds.map((scenarioId) => ({
        fixtureId: scenarioId,
        passed: !family.failedScenarioIds.includes(scenarioId),
      })),
      targetRate: E2E_ASSESSMENT_MIN_DIMENSION_PASS_RATE,
      comparator: 'min',
    }),
  );
}

export function isE2EAssessmentEvidencePassing(report: E2EAssessmentReport): boolean {
  return report.dimensionsPassing && report.benchmarkFamiliesPassing;
}

export function formatE2EAssessmentReportSummary(report: E2EAssessmentReport): string {
  const lines = [
    `[e2e-assessment] evidenceScore=${report.evidenceScore.toFixed(3)} overallPassRate=${report.overallScenarioPassRate.toFixed(3)} scenarios=${report.scenarioCount}`,
    `[e2e-assessment] dimensionsPassing=${report.dimensionsPassing} benchmarkFamiliesPassing=${report.benchmarkFamiliesPassing}`,
  ];

  for (const dimension of report.dimensions) {
    lines.push(
      [
        `dimension:${dimension.id}`,
        `${dimension.passed}/${dimension.total}`,
        `rate=${dimension.passRate.toFixed(3)}`,
        dimension.passing ? 'pass' : 'fail',
        dimension.failedScenarioIds.length > 0
          ? `failed=${dimension.failedScenarioIds.join(',')}`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  for (const family of report.benchmarkFamilies) {
    lines.push(
      [
        `benchmark:${family.id}`,
        `${family.passed}/${family.total}`,
        `rate=${family.passRate.toFixed(3)}`,
        family.passing ? 'pass' : 'fail',
        family.failedScenarioIds.length > 0 ? `failed=${family.failedScenarioIds.join(',')}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  return lines.join('\n');
}

export function summarizeAssessmentDimension(
  dimensionId: E2EAssessmentDimension,
): string {
  return E2E_ASSESSMENT_DIMENSION_LABELS[dimensionId];
}

export function summarizeBenchmarkFamily(familyId: E2EBenchmarkFamily): string {
  return E2E_BENCHMARK_FAMILY_META[familyId].externalReference;
}

export function isAssessmentSummaryPassing(summary: AcceptanceMetricSummary): boolean {
  return isSummaryPassing(summary);
}