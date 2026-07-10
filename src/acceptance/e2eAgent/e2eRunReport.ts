// ---------------------------------------------------------------------------
// Kavi — E2E run report (JSON artifact for nightly trend tracking)
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'fs';
import { dirname, join, resolve } from 'path';

import { parseOptionalStrictPositiveInteger } from '../../../scripts/e2eReport/configParsing';
import {
  atomicWriteFileSync,
  removeManagedTransactionResidueSync,
  replaceDirectoryFromStagingSync,
  uniqueManagedPath,
  withFileLockSync,
} from '../../../scripts/e2eReport/fileTransaction';
import {
  readPartialReportFile,
  SCENARIO_ENTRY_SCHEMA_VERSION,
  writePartialReportFile,
} from '../../../scripts/e2eReport/partialReport';
import type { PublicE2ERunReport } from '../../../scripts/e2eReport/publicRunReport';
import {
  RETAINED_RUN_MANIFEST_FILE,
  buildRetainedRunManifest,
  sha256,
  validateRetainedRunDirectory,
} from '../../../scripts/e2eReport/retainedRunManifest';

import { evaluateE2EAgentOutcomes, isE2EAgentMetricsPassing } from './evaluateE2EAgentMetrics';
import { buildE2EAssessmentReport, type E2EAssessmentReport } from './e2eAssessmentReport';
import type { E2EAssessmentDimension } from './e2eAssessmentDimensions';
import type { E2EBenchmarkFamily } from './e2eBenchmarkRegistry';
import { resolveE2EScenarioMaxRetries } from './e2eRetryPolicy';
import {
  buildE2EReadinessDashboard,
  E2E_READINESS_ARTIFACT_RETENTION_RUNS,
  E2E_READINESS_DASHBOARD_VERSION,
  formatE2EReadinessDashboardSummary,
  type E2EReadinessDashboard,
} from './e2eReadinessDashboard';
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
  writeE2ERedactedTraceArtifacts,
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
export const E2E_READINESS_ARTIFACT_RETENTION_DIR_ENV = 'E2E_READINESS_ARTIFACT_RETENTION_DIR';
export const E2E_READINESS_ARTIFACT_RETENTION_LIMIT_ENV = 'E2E_READINESS_ARTIFACT_RETENTION_LIMIT';
export const E2E_RUN_REPORT_SCHEMA_VERSION = 'e2e-run-report-v2';

export { buildE2ERunReportScenarioEntry };
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

type E2EReadinessArtifactIndexEntry = {
  runId: string;
  generatedAt: string;
  gitSha: string;
  provider: string;
  model: string;
  manifestRelativePath: string;
  manifestSha256: string;
  reportRelativePath: string;
  dashboardRelativePath: string;
  passing: boolean;
  scenarioPassRate: number;
  pass1Rate: number;
};

function resolveReadinessArtifactRetentionLimit(env: NodeJS.ProcessEnv): number {
  return (
    parseOptionalStrictPositiveInteger(
      env[E2E_READINESS_ARTIFACT_RETENTION_LIMIT_ENV],
      'E2E readiness artifact retention limit',
    ) ?? E2E_READINESS_ARTIFACT_RETENTION_RUNS
  );
}

function sanitizeRunIdPart(value: string | undefined): string {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_.-]+/g, '-');
}

function isSafeRunId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== '.' &&
    value !== '..' &&
    value.length > 0 &&
    sanitizeRunIdPart(value) === value
  );
}

function normalizeCurrentReadinessIndexEntry(
  value: unknown,
): E2EReadinessArtifactIndexEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const entry = value as Partial<E2EReadinessArtifactIndexEntry>;
  if (
    !isSafeRunId(entry.runId) ||
    entry.reportRelativePath !== `${entry.runId}/report.json` ||
    entry.dashboardRelativePath !== `${entry.runId}/dashboard.json` ||
    typeof entry.generatedAt !== 'string' ||
    typeof entry.gitSha !== 'string' ||
    typeof entry.provider !== 'string' ||
    typeof entry.model !== 'string' ||
    entry.manifestRelativePath !== `${entry.runId}/${RETAINED_RUN_MANIFEST_FILE}` ||
    typeof entry.manifestSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(entry.manifestSha256) ||
    typeof entry.passing !== 'boolean' ||
    !Number.isFinite(entry.scenarioPassRate) ||
    !Number.isFinite(entry.pass1Rate)
  ) {
    return null;
  }
  return {
    runId: entry.runId,
    generatedAt: entry.generatedAt,
    gitSha: entry.gitSha,
    provider: entry.provider,
    model: entry.model,
    manifestRelativePath: entry.manifestRelativePath,
    manifestSha256: entry.manifestSha256,
    reportRelativePath: entry.reportRelativePath,
    dashboardRelativePath: entry.dashboardRelativePath,
    passing: entry.passing,
    scenarioPassRate: entry.scenarioPassRate!,
    pass1Rate: entry.pass1Rate!,
  };
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function readReadinessIndexState(indexPath: string): {
  currentRuns: E2EReadinessArtifactIndexEntry[];
  discardedRunIds: string[];
} {
  const index = readJsonFile<{ version?: string; runs?: unknown[] }>(indexPath, {
    version: E2E_READINESS_DASHBOARD_VERSION,
    runs: [],
  });
  if (!index || typeof index !== 'object' || !Array.isArray(index.runs)) {
    throw new Error('E2E readiness index is malformed.');
  }
  if (index.version !== E2E_READINESS_DASHBOARD_VERSION) {
    return {
      currentRuns: [],
      discardedRunIds: index.runs
        .map((run) =>
          run && typeof run === 'object' ? (run as { runId?: unknown }).runId : undefined,
        )
        .filter(isSafeRunId),
    };
  }
  const currentRuns = index.runs.map(normalizeCurrentReadinessIndexEntry);
  if (currentRuns.some((run) => run === null)) {
    throw new Error('E2E readiness index contains an invalid current-schema run.');
  }
  const validRuns = currentRuns as E2EReadinessArtifactIndexEntry[];
  const runIds = validRuns.map((run) => run.runId);
  if (new Set(runIds).size !== runIds.length) {
    throw new Error('E2E readiness index contains duplicate run ids.');
  }
  return { currentRuns: validRuns, discardedRunIds: [] };
}

function validateAndRecoverIndexedRunDirectories(
  retentionDir: string,
  runs: ReadonlyArray<E2EReadinessArtifactIndexEntry>,
): { currentRuns: E2EReadinessArtifactIndexEntry[]; discardedRunIds: string[] } {
  const currentRuns: E2EReadinessArtifactIndexEntry[] = [];
  const discardedRunIds: string[] = [];
  for (const run of runs) {
    try {
      removeManagedTransactionResidueSync(retentionDir, run.runId);
      if (validateRetainedRunDirectory(retentionDir, run)) {
        currentRuns.push(run);
      } else {
        discardedRunIds.push(run.runId);
      }
    } catch {
      discardedRunIds.push(run.runId);
    }
  }
  return { currentRuns, discardedRunIds };
}

function closeRetentionRoot(retentionDir: string, retainedRunIds: ReadonlySet<string>): void {
  const allowedEntries = new Set(['.artifact.lock.lock', 'index.json', ...retainedRunIds]);
  for (const entry of readdirSync(retentionDir)) {
    if (!allowedEntries.has(entry)) {
      rmSync(join(retentionDir, entry), { recursive: true, force: true });
    }
  }
}

export function writeE2EReadinessDashboardArtifacts(
  resolvedReportPath: string,
  report: E2ERunReport,
  env: NodeJS.ProcessEnv = process.env,
): { dashboardPath: string; runDir: string; indexPath: string; report: PublicE2ERunReport } {
  const dashboardPath = `${resolvedReportPath}.dashboard.json`;
  const retentionDir = resolve(
    env[E2E_READINESS_ARTIFACT_RETENTION_DIR_ENV]?.trim() ||
      join(dirname(resolvedReportPath), 'e2e-readiness-runs'),
  );
  const runId = `run-${sanitizeRunIdPart(report.generatedAt)}-${sanitizeRunIdPart(
    report.runMetadata.gitSha,
  ).slice(0, 12)}`;
  const runDir = join(retentionDir, runId);
  const indexPath = join(retentionDir, 'index.json');
  const retentionLimit = resolveReadinessArtifactRetentionLimit(env);
  return withFileLockSync(join(retentionDir, '.artifact.lock'), () => {
    mkdirSync(retentionDir, { recursive: true });
    const indexState = readReadinessIndexState(indexPath);
    const retainedHistory = validateAndRecoverIndexedRunDirectories(
      retentionDir,
      indexState.currentRuns,
    );
    removeManagedTransactionResidueSync(retentionDir, runId);
    const stagingDir = uniqueManagedPath(retentionDir, runId, 'staging');
    mkdirSync(stagingDir, { recursive: true });
    try {
      const reportWithTraceArtifacts = writeE2ERedactedTraceArtifacts(report, stagingDir, runId);
      atomicWriteFileSync(
        join(stagingDir, 'report.json'),
        JSON.stringify(reportWithTraceArtifacts, null, 2),
        'utf8',
      );
      atomicWriteFileSync(
        join(stagingDir, 'dashboard.json'),
        JSON.stringify(reportWithTraceArtifacts.readinessDashboard, null, 2),
        'utf8',
      );
      const manifestContent = JSON.stringify(
        buildRetainedRunManifest(stagingDir, runId, report.generatedAt),
        null,
        2,
      );
      atomicWriteFileSync(join(stagingDir, RETAINED_RUN_MANIFEST_FILE), manifestContent, 'utf8');
      const manifestSha256 = sha256(manifestContent);
      replaceDirectoryFromStagingSync(stagingDir, runDir);

      const withoutDuplicate = retainedHistory.currentRuns.filter(
        (previousRun) => previousRun.runId !== runId,
      );
      const runs: E2EReadinessArtifactIndexEntry[] = [
        {
          runId,
          generatedAt: report.generatedAt,
          gitSha: report.runMetadata.gitSha,
          provider: report.runMetadata.provider,
          model: report.runMetadata.model,
          manifestRelativePath: `${runId}/${RETAINED_RUN_MANIFEST_FILE}`,
          manifestSha256,
          reportRelativePath: `${runId}/report.json`,
          dashboardRelativePath: `${runId}/dashboard.json`,
          passing: report.readinessDashboard.overall.passing,
          scenarioPassRate: report.readinessDashboard.overall.scenarioPassRate,
          pass1Rate: report.readinessDashboard.overall.pass1Rate,
        },
        ...withoutDuplicate,
      ];
      const retainedRuns = runs.slice(0, retentionLimit);
      const retainedRunIds = new Set(retainedRuns.map((run) => run.runId));
      atomicWriteFileSync(
        indexPath,
        JSON.stringify(
          {
            version: E2E_READINESS_DASHBOARD_VERSION,
            retainedRunCount: retainedRuns.length,
            retentionLimit,
            runs: retainedRuns,
          },
          null,
          2,
        ),
        'utf8',
      );
      for (const discardedRunId of [
        ...indexState.discardedRunIds,
        ...retainedHistory.discardedRunIds,
      ]) {
        if (!retainedRunIds.has(discardedRunId)) {
          rmSync(join(retentionDir, discardedRunId), { recursive: true, force: true });
        }
      }
      closeRetentionRoot(retentionDir, retainedRunIds);
      atomicWriteFileSync(
        dashboardPath,
        JSON.stringify(reportWithTraceArtifacts.readinessDashboard, null, 2),
        'utf8',
      );
      return { dashboardPath, runDir, indexPath, report: reportWithTraceArtifacts };
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  });
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
