// ---------------------------------------------------------------------------
// Kavi — E2E run report (JSON artifact for nightly trend tracking)
// ---------------------------------------------------------------------------

import { existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';

import { atomicWriteFileSync, withFileLockSync } from '../../../scripts/e2eReport/fileTransaction';
import {
  readPartialReportFile,
  SCENARIO_ENTRY_SCHEMA_VERSION,
  writePartialReportFile,
} from '../../../scripts/e2eReport/partialReport';
import type { PublicE2ERunReport } from '../../../scripts/e2eReport/publicRunReport';
import { evaluateE2EAgentOutcomes, isE2EAgentMetricsPassing } from './evaluateE2EAgentMetrics';
import { buildE2EAssessmentReport, type E2EAssessmentReport } from './e2eAssessmentReport';
import type { E2EAssessmentDimension } from './e2eAssessmentDimensions';
import type { E2EBenchmarkFamily } from './e2eBenchmarkRegistry';
import { resolveE2EScenarioMaxRetries } from './e2eRetryPolicy';
import {
  buildE2EReadinessDashboard,
  formatE2EReadinessDashboardSummary,
  type E2EReadinessDashboard,
} from './e2eReadinessDashboard';
import { writeE2EReadinessDashboardArtifacts } from './e2eRunReportArtifacts';
import { buildCacheReport } from './e2eRunReportCache';
import { safeRate } from './e2eRunReportMath';
import {
  buildGraderAudit,
  buildReadinessReport,
  buildReliabilityReport,
} from './e2eRunReportReadiness';
import { buildE2ERunReportScenarioEntry } from './e2eRunReportScenario';
import {
  resolveE2ERunMetadata,
  type E2ERunMetadataOverrides,
  type E2ERunReportRunMetadata,
} from './e2eRunMetadata';
import {
  type E2ERunReportScenarioTraceArtifact,
  type E2EScenarioTraceSummary,
} from './e2eTraceArtifacts';
import type { AcceptanceFixtureOutcome } from '../acceptanceMetrics/types';
import type {
  E2EPromptCachePrefixStability,
  E2EPromptCacheReasonCount,
  E2EScenarioResult,
  E2ETokenUsageSummary,
} from './types';
import type { UsageTokenBuckets } from '../../types/usage';

export const E2E_REPORT_PATH_ENV = 'E2E_REPORT_PATH';
export const E2E_REPORT_PARTIAL_PATH_ENV = 'E2E_REPORT_PARTIAL_PATH';
export const E2E_RUN_REPORT_SCHEMA_VERSION = 'e2e-run-report-v2';

export { buildE2ERunReportScenarioEntry };
export {
  E2E_READINESS_ARTIFACT_RETENTION_DIR_ENV,
  E2E_READINESS_ARTIFACT_RETENTION_LIMIT_ENV,
  writeE2EReadinessDashboardArtifacts,
} from './e2eRunReportArtifacts';
export { digestE2EProviderEndpoint, resolveE2ERunMetadata } from './e2eRunMetadata';
export type { E2ERunMetadataOverrides, E2ERunReportRunMetadata } from './e2eRunMetadata';

export type E2ERunReportRubricFailure = {
  fixtureId: string;
  detail?: string;
};

export type E2ERunReportScenarioCache = {
  inputTokens: number;
  eligibleInputTokens: number;
  providerManagedReadinessTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheReadRate: number;
  eligibleCacheReadRate: number;
  eligible: boolean;
};

export type E2ERunReportRubricAuditRisk = {
  rubricKind: string;
  reason: string;
};

export type E2ERunReportScenarioRubricAudit = {
  rubricCount: number;
  assistantProseRubricCount: number;
  weakPatternRubricCount: number;
  structuralSubstringRubricCount: number;
  risks: E2ERunReportRubricAuditRisk[];
};

export type E2ERunReportScenarioLoopDiagnostics = {
  repeatedToolCalls: Array<{
    name: string;
    argsHash: string;
    count: number;
    noNewEvidence: boolean;
  }>;
  repeatedCatalogAfterActivationCount: number;
  repeatedHoldReasons: Array<{
    reason: string;
    count: number;
  }>;
  passing: boolean;
};

export type E2ERunReportScenarioEntry = {
  schemaVersion: typeof SCENARIO_ENTRY_SCHEMA_VERSION;
  suite: string;
  fixtureId: string;
  contentClass: E2EScenarioResult['contentClass'];
  passed: boolean;
  attemptCount: number;
  durationMs: number;
  completed: boolean;
  userTurnCount: number;
  toolCallCount: number;
  turnCount: number;
  graphStatus: string | null;
  usage: E2EScenarioResult['usage'];
  tokenBuckets: UsageTokenBuckets;
  cache: E2ERunReportScenarioCache;
  promptCache?: E2ETokenUsageSummary['promptCache'];
  loopDiagnostics: E2ERunReportScenarioLoopDiagnostics;
  benchmarkFamilies: ReadonlyArray<E2EBenchmarkFamily>;
  assessmentDimensions: ReadonlyArray<E2EAssessmentDimension>;
  rubricPassed?: number;
  rubricTotal?: number;
  failedRubrics?: ReadonlyArray<E2ERunReportRubricFailure>;
  rubricAudit: E2ERunReportScenarioRubricAudit;
  trace?: E2EScenarioTraceSummary;
  traceArtifact?: E2ERunReportScenarioTraceArtifact;
  detail?: string;
  errors: ReadonlyArray<string>;
};

export type E2ERunReportCacheFailureBucket = {
  providerStatus: string;
  count: number;
};

export type E2EPromptCacheCreateTelemetrySnapshot = {
  cacheCreateAttempts: number;
  cacheCreateFailureCount: number;
  cacheCreateFailuresByProviderStatus: E2ERunReportCacheFailureBucket[];
  cacheCreateTelemetryAvailable: boolean;
};

export type E2ERunReportCacheSummary = {
  inputTokens: number;
  eligibleInputTokens: number;
  providerManagedReadinessTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheReadRate: number;
  eligibleCacheReadRate: number;
  eligibleScenarioCount: number;
  eligibleInputThreshold: number;
  targetEligibleCacheReadRate: number;
  providerManagedReadinessObserved: boolean;
  passing: boolean;
  cacheCreateAttempts: number;
  cacheCreateFailureCount: number;
  cacheCreateFailuresByProviderStatus: E2ERunReportCacheFailureBucket[];
  cacheCreateTelemetryAvailable: boolean;
  promptCacheTelemetry: {
    eligibleTurnCount: number;
    enabledTurnCount: number;
    skippedTurnCount: number;
    createEventCount: number;
    reuseEventCount: number;
    providerManagedEventCount: number;
    thresholdTokens: number[];
    explicitCacheNameCount: number;
    reasonCounts: E2EPromptCacheReasonCount[];
    prefixStability: E2EPromptCachePrefixStability;
  };
  scenarios: ReadonlyArray<{
    fixtureId: string;
    inputTokens: number;
    eligibleInputTokens: number;
    providerManagedReadinessTokens: number;
    cacheReadTokens: number;
    cacheReadRate: number;
    eligibleCacheReadRate: number;
    tokenBuckets: UsageTokenBuckets;
    promptCache?: E2ETokenUsageSummary['promptCache'];
  }>;
};

export type E2ERunReportGraderAudit = {
  scenarioCount: number;
  auditedScenarioCount: number;
  rubricCount: number;
  assistantProseRubricCount: number;
  weakPatternRubricCount: number;
  structuralSubstringRubricCount: number;
  missingRubricAuditScenarioIds: string[];
  risks: E2ERunReportRubricAuditRisk[];
  passing: boolean;
};

export type E2ERunReportReadiness = {
  passing: boolean;
  targetScenarioCount: number;
  targetScenarioPassRate: number;
  targetAxisPassRate: number;
  scenarioPassRate: number;
  pass1Rate: number;
  passKRate: number;
  cacheEligibleReadRate: number;
  cachePassing: boolean;
  graderAuditPassing: boolean;
  criticalFailureCount: number;
  criticalFailedScenarioIds: string[];
  failedCriteria: string[];
};

export type E2ERunReportReliabilityScenario = {
  fixtureId: string;
  passed: boolean;
  attemptCount: number;
  k: number;
  passAt1: boolean;
  passAtK: boolean;
  retriesUsed: number;
};

export type E2ERunReportReliability = {
  k: number;
  scenarioCount: number;
  pass1PassedCount: number;
  passKPassedCount: number;
  pass1Rate: number;
  passKRate: number;
  retriedScenarioCount: number;
  scenarios: E2ERunReportReliabilityScenario[];
};

export type E2ERunReport = {
  schemaVersion: typeof E2E_RUN_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  maxScenarioRetries: number;
  runMetadata: E2ERunReportRunMetadata;
  scenarios: E2ERunReportScenarioEntry[];
  totals: {
    scenarioCount: number;
    passedCount: number;
    failedCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    durationMs: number;
  };
  cache: E2ERunReportCacheSummary;
  graderAudit: E2ERunReportGraderAudit;
  assessment: E2EAssessmentReport;
  reliability: E2ERunReportReliability;
  readiness: E2ERunReportReadiness;
  readinessDashboard: E2EReadinessDashboard;
  metricsPassing: boolean;
};

export function buildE2ERunReport(
  entries: ReadonlyArray<E2ERunReportScenarioEntry>,
  options?: {
    generatedAt?: string;
    maxScenarioRetries?: number;
    runMetadata?: E2ERunMetadataOverrides;
    runMetadataEnv?: NodeJS.ProcessEnv;
    metricOutcomes?: ReadonlyArray<AcceptanceFixtureOutcome>;
    metricResults?: ReadonlyArray<E2EScenarioResult>;
    cacheTelemetry?: E2EPromptCacheCreateTelemetrySnapshot;
  },
): E2ERunReport {
  const maxScenarioRetries = options?.maxScenarioRetries ?? resolveE2EScenarioMaxRetries();
  const passedCount = entries.filter((entry) => entry.passed).length;
  const totals = entries.reduce(
    (acc, entry) => ({
      scenarioCount: acc.scenarioCount + 1,
      passedCount: acc.passedCount + (entry.passed ? 1 : 0),
      failedCount: acc.failedCount + (entry.passed ? 0 : 1),
      inputTokens: acc.inputTokens + entry.usage.inputTokens,
      outputTokens: acc.outputTokens + entry.usage.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + entry.usage.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + entry.usage.cacheWriteTokens,
      totalTokens: acc.totalTokens + entry.usage.totalTokens,
      durationMs: acc.durationMs + entry.durationMs,
    }),
    {
      scenarioCount: 0,
      passedCount: 0,
      failedCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      durationMs: 0,
    },
  );

  let metricsPassing = passedCount === entries.length && entries.length > 0;
  if (options?.metricOutcomes?.length) {
    const evaluation = evaluateE2EAgentOutcomes(options.metricOutcomes, options.metricResults);
    metricsPassing = isE2EAgentMetricsPassing(evaluation);
  }

  const assessment = buildE2EAssessmentReport(entries, {
    generatedAt: options?.generatedAt,
  });
  const cache = buildCacheReport(entries, options?.metricResults, options?.cacheTelemetry);
  const graderAudit = buildGraderAudit(entries);
  const reliability = buildReliabilityReport(entries, maxScenarioRetries);
  const generatedAt = options?.generatedAt ?? new Date().toISOString();
  const runMetadata = resolveE2ERunMetadata(options?.runMetadata, options?.runMetadataEnv);
  const readiness = buildReadinessReport({
    entries,
    assessment,
    cache,
    graderAudit,
    reliability,
  });
  const readinessDashboard = buildE2EReadinessDashboard({
    generatedAt,
    runMetadata,
    entries,
    totals,
    cache,
    graderAudit,
    assessment,
    reliability,
    readiness,
  });

  return {
    schemaVersion: E2E_RUN_REPORT_SCHEMA_VERSION,
    generatedAt,
    maxScenarioRetries,
    runMetadata,
    scenarios: [...entries],
    totals,
    cache,
    graderAudit,
    assessment,
    reliability,
    readiness,
    readinessDashboard,
    metricsPassing,
  };
}

function resolvePartialReportPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env[E2E_REPORT_PARTIAL_PATH_ENV]?.trim();
  if (configured) {
    return resolve(configured);
  }
  const reportPath = env[E2E_REPORT_PATH_ENV]?.trim();
  if (!reportPath) {
    return null;
  }
  return `${resolve(reportPath)}.partial.json`;
}

function readPartialEntries(partialPath: string): E2ERunReportScenarioEntry[] {
  return readPartialReportFile<E2ERunReportScenarioEntry>(partialPath).entries;
}

export function recordE2ERunReportEntry(
  entry: E2ERunReportScenarioEntry,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const partialPath = resolvePartialReportPath(env);
  if (!partialPath) {
    return;
  }
  withFileLockSync(`${partialPath}.lock`, () => {
    const existing = readPartialEntries(partialPath);
    const withoutDuplicate = existing.filter(
      (candidate) => !(candidate.suite === entry.suite && candidate.fixtureId === entry.fixtureId),
    );
    writePartialReportFile(partialPath, [...withoutDuplicate, entry]);
  });
}

export function flushE2ERunReport(env: NodeJS.ProcessEnv = process.env): PublicE2ERunReport | null {
  const reportPath = env[E2E_REPORT_PATH_ENV]?.trim();
  const partialPath = resolvePartialReportPath(env);
  if (!reportPath || !partialPath) {
    return null;
  }
  return withFileLockSync(`${partialPath}.lock`, () => {
    const entries = readPartialEntries(partialPath);
    if (entries.length === 0) {
      return null;
    }
    const report = buildE2ERunReport(entries, {
      maxScenarioRetries: resolveE2EScenarioMaxRetries(env),
      runMetadataEnv: env,
    });

    const resolvedReportPath = resolve(reportPath);
    const artifacts = writeE2EReadinessDashboardArtifacts(resolvedReportPath, report, env);
    atomicWriteFileSync(resolvedReportPath, JSON.stringify(artifacts.report, null, 2), 'utf8');
    if (existsSync(partialPath)) {
      unlinkSync(partialPath);
    }
    return artifacts.report;
  });
}

export function formatE2ERunReportSummary(report: E2ERunReport): string {
  const lines = [
    `[e2e-run-report] generatedAt=${report.generatedAt}`,
    `[e2e-run-report] scenarios=${report.totals.passedCount}/${report.totals.scenarioCount} passed`,
    `[e2e-run-report] reliability pass1=${report.reliability.pass1PassedCount}/${report.reliability.scenarioCount} pass^${report.reliability.k}=${report.reliability.passKPassedCount}/${report.reliability.scenarioCount} retried=${report.reliability.retriedScenarioCount}`,
    `[e2e-run-report] tokens in=${report.totals.inputTokens} out=${report.totals.outputTokens} cacheR=${report.totals.cacheReadTokens} total=${report.totals.totalTokens}`,
    `[e2e-run-report] cache eligibleIn=${report.cache.eligibleInputTokens} eligibleRate=${report.cache.eligibleCacheReadRate.toFixed(3)} target=${report.cache.targetEligibleCacheReadRate.toFixed(3)} providerManagedReadinessTokens=${report.cache.providerManagedReadinessTokens} passing=${report.cache.passing}`,
    `[e2e-run-report] durationMs=${report.totals.durationMs} maxRetries=${report.maxScenarioRetries}`,
    `[e2e-run-report] metricsPassing=${report.metricsPassing}`,
    `[e2e-run-report] readiness=${report.readiness.passing} failedCriteria=${report.readiness.failedCriteria.join(',') || 'none'}`,
    `[e2e-run-report] graderAudit=${report.graderAudit.passing} proseRubrics=${report.graderAudit.assistantProseRubricCount} weakPatternRubrics=${report.graderAudit.weakPatternRubricCount}`,
    `[e2e-run-report] assessment evidenceScore=${report.assessment.evidenceScore.toFixed(3)} dimensionsPassing=${report.assessment.dimensionsPassing}`,
    formatE2EReadinessDashboardSummary(report.readinessDashboard),
  ];
  for (const scenario of report.scenarios) {
    lines.push(
      [
        scenario.fixtureId,
        scenario.passed ? 'pass' : 'fail',
        `attempts=${scenario.attemptCount}`,
        `in=${scenario.usage.inputTokens}`,
        `eligibleIn=${scenario.cache?.eligibleInputTokens ?? 0}`,
        `out=${scenario.usage.outputTokens}`,
        `cacheR=${scenario.usage.cacheReadTokens}`,
        `cacheRate=${safeRate(scenario.usage.cacheReadTokens, scenario.usage.inputTokens).toFixed(3)}`,
        `total=${scenario.usage.totalTokens}`,
        `ms=${scenario.durationMs}`,
      ].join(' '),
    );
  }
  return lines.join('\n');
}
