// ---------------------------------------------------------------------------
// Kavi — E2E run report (JSON artifact for nightly trend tracking)
// ---------------------------------------------------------------------------

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

import {
  evaluateE2EAgentOutcomes,
  isE2EAgentMetricsPassing,
} from './evaluateE2EAgentMetrics';
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
  type E2ERunReportScenarioTraceArtifact,
  type E2EScenarioTraceSummary,
  writeE2ERedactedTraceArtifacts,
} from './e2eTraceArtifacts';
import {
  resolveE2EProviderBaseUrl,
  resolveE2EProviderKey,
  resolveE2EProviderModel,
  resolveE2EProviderSpec,
} from './providerConfig';
import {
  E2E_NATIVE_TOOL_FIXTURE_VERSION,
  E2E_SCENARIO_MANIFEST_VERSION,
} from './thresholds';
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

export { buildE2ERunReportScenarioEntry };

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

export type E2ERunReportRunMetadata = {
  gitSha: string;
  provider: string;
  providerId?: string;
  model: string;
  modelVersion?: string;
  providerBaseUrl: string;
  temperature?: number;
  seed?: string;
  scenarioManifestVersion: string;
  promptCacheMode: string;
  nativeToolFixtureVersion: string;
  collectMode: boolean;
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

function resolveOptionalNumber(raw: string | undefined): number | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveGitSha(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.E2E_GIT_SHA?.trim() || env.GITHUB_SHA?.trim() || env.CI_COMMIT_SHA?.trim();
  if (configured) {
    return configured;
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function resolveE2ERunMetadata(
  overrides?: Partial<E2ERunReportRunMetadata>,
  env: NodeJS.ProcessEnv = process.env,
): E2ERunReportRunMetadata {
  const modelVersion = overrides?.modelVersion ?? env.E2E_MODEL_VERSION?.trim();
  const temperature = overrides?.temperature ?? resolveOptionalNumber(env.E2E_TEMPERATURE);
  const seed = overrides?.seed ?? env.E2E_SEED?.trim();
  const promptCacheMode =
    overrides?.promptCacheMode ?? env.E2E_PROMPT_CACHE_MODE?.trim() ?? 'provider-default';
  const providerKey = resolveE2EProviderKey(env);
  const providerSpec = resolveE2EProviderSpec(providerKey);
  const provider = overrides?.provider ?? providerSpec.family;
  const model =
    overrides?.model ?? resolveE2EProviderModel(providerKey, env) ?? `unknown-${providerKey}-model`;
  const providerBaseUrl =
    overrides?.providerBaseUrl ?? resolveE2EProviderBaseUrl(providerKey, env) ?? 'unknown';

  return {
    gitSha: overrides?.gitSha ?? resolveGitSha(env),
    provider,
    providerId: overrides?.providerId ?? providerSpec.id,
    model,
    ...(modelVersion ? { modelVersion } : {}),
    providerBaseUrl,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(seed ? { seed } : {}),
    scenarioManifestVersion: overrides?.scenarioManifestVersion ?? E2E_SCENARIO_MANIFEST_VERSION,
    promptCacheMode,
    nativeToolFixtureVersion:
      overrides?.nativeToolFixtureVersion ?? E2E_NATIVE_TOOL_FIXTURE_VERSION,
    collectMode: overrides?.collectMode ?? env.E2E_COLLECT_MODE === '1',
  };
}

export function buildE2ERunReport(
  entries: ReadonlyArray<E2ERunReportScenarioEntry>,
  options?: {
    generatedAt?: string;
    maxScenarioRetries?: number;
    runMetadata?: Partial<E2ERunReportRunMetadata>;
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
  const runMetadata = resolveE2ERunMetadata(options?.runMetadata);
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
  if (!existsSync(partialPath)) {
    return [];
  }
  const raw = readFileSync(partialPath, 'utf8').trim();
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed as E2ERunReportScenarioEntry[];
}

type E2EReadinessArtifactIndexEntry = {
  runId: string;
  generatedAt: string;
  gitSha: string;
  provider: string;
  model: string;
  reportPath: string;
  dashboardPath: string;
  passing: boolean;
  scenarioPassRate: number;
  pass1Rate: number;
};

function parseNonNegativeInteger(value: string | undefined): number | null {
  if (!value?.trim()) {
    return null;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function resolveReadinessArtifactRetentionLimit(env: NodeJS.ProcessEnv): number {
  return (
    parseNonNegativeInteger(env[E2E_READINESS_ARTIFACT_RETENTION_LIMIT_ENV]) ??
    E2E_READINESS_ARTIFACT_RETENTION_RUNS
  );
}

function sanitizeRunIdPart(value: string | undefined): string {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_.-]+/g, '-');
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeE2EReadinessDashboardArtifacts(
  resolvedReportPath: string,
  report: E2ERunReport,
  env: NodeJS.ProcessEnv = process.env,
): { dashboardPath: string; runDir: string; indexPath: string; report: E2ERunReport } {
  const dashboardPath = `${resolvedReportPath}.dashboard.json`;

  const retentionDir = resolve(
    env[E2E_READINESS_ARTIFACT_RETENTION_DIR_ENV]?.trim() ||
      join(dirname(resolvedReportPath), 'e2e-readiness-runs'),
  );
  const runId = `${sanitizeRunIdPart(report.generatedAt)}-${sanitizeRunIdPart(
    report.runMetadata.gitSha,
  ).slice(0, 12)}`;
  const runDir = join(retentionDir, runId);
  mkdirSync(runDir, { recursive: true });
  const reportWithTraceArtifacts = writeE2ERedactedTraceArtifacts(report, runDir);
  writeFileSync(
    dashboardPath,
    JSON.stringify(reportWithTraceArtifacts.readinessDashboard, null, 2),
    'utf8',
  );
  writeFileSync(
    join(runDir, 'report.json'),
    JSON.stringify(reportWithTraceArtifacts, null, 2),
    'utf8',
  );
  writeFileSync(
    join(runDir, 'dashboard.json'),
    JSON.stringify(reportWithTraceArtifacts.readinessDashboard, null, 2),
    'utf8',
  );

  const indexPath = join(retentionDir, 'index.json');
  const previousIndex = readJsonFile<{ runs?: E2EReadinessArtifactIndexEntry[] }>(indexPath, {
    runs: [],
  });
  const withoutDuplicate = Array.isArray(previousIndex.runs)
    ? previousIndex.runs.filter((run) => run.runId !== runId)
    : [];
  const runs: E2EReadinessArtifactIndexEntry[] = [
    {
      runId,
      generatedAt: report.generatedAt,
      gitSha: report.runMetadata.gitSha,
      provider: report.runMetadata.provider,
      model: report.runMetadata.model,
      reportPath: join(runDir, 'report.json'),
      dashboardPath: join(runDir, 'dashboard.json'),
      passing: report.readinessDashboard.overall.passing,
      scenarioPassRate: report.readinessDashboard.overall.scenarioPassRate,
      pass1Rate: report.readinessDashboard.overall.pass1Rate,
    },
    ...withoutDuplicate,
  ].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));

  const retainedRuns = runs.slice(0, resolveReadinessArtifactRetentionLimit(env));
  for (const run of runs.slice(retainedRuns.length)) {
    rmSync(join(retentionDir, run.runId), { recursive: true, force: true });
  }

  mkdirSync(retentionDir, { recursive: true });
  writeFileSync(
    indexPath,
    JSON.stringify(
      {
        version: E2E_READINESS_DASHBOARD_VERSION,
        retainedRunCount: retainedRuns.length,
        retentionLimit: resolveReadinessArtifactRetentionLimit(env),
        runs: retainedRuns,
      },
      null,
      2,
    ),
    'utf8',
  );

  return { dashboardPath, runDir, indexPath, report: reportWithTraceArtifacts };
}

export function recordE2ERunReportEntry(
  entry: E2ERunReportScenarioEntry,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const partialPath = resolvePartialReportPath(env);
  if (!partialPath) {
    return;
  }
  mkdirSync(dirname(partialPath), { recursive: true });
  const existing = readPartialEntries(partialPath);
  const withoutDuplicate = existing.filter(
    (candidate) => !(candidate.suite === entry.suite && candidate.fixtureId === entry.fixtureId),
  );
  writeFileSync(partialPath, JSON.stringify([...withoutDuplicate, entry], null, 2), 'utf8');
}

export function flushE2ERunReport(env: NodeJS.ProcessEnv = process.env): E2ERunReport | null {
  const reportPath = env[E2E_REPORT_PATH_ENV]?.trim();
  const partialPath = resolvePartialReportPath(env);
  if (!reportPath || !partialPath) {
    return null;
  }

  const entries = readPartialEntries(partialPath);
  const report = buildE2ERunReport(entries, {
    maxScenarioRetries: resolveE2EScenarioMaxRetries(env),
    runMetadata: resolveE2ERunMetadata(undefined, env),
  });

  mkdirSync(dirname(resolve(reportPath)), { recursive: true });
  const resolvedReportPath = resolve(reportPath);
  const artifacts = writeE2EReadinessDashboardArtifacts(resolvedReportPath, report, env);
  writeFileSync(resolvedReportPath, JSON.stringify(artifacts.report, null, 2), 'utf8');

  if (existsSync(partialPath)) {
    unlinkSync(partialPath);
  }

  return artifacts.report;
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
