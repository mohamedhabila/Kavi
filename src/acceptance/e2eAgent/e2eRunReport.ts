// ---------------------------------------------------------------------------
// Kavi — E2E run report (JSON artifact for nightly trend tracking)
// ---------------------------------------------------------------------------

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

import {
  buildE2EProgramCacheStats,
  evaluateE2EAgentOutcomes,
  estimateE2EEligibleCacheReadStats,
  estimateEligibleCacheReadTokens,
  estimateE2EProviderManagedCacheReadinessTokens,
  estimateUsageProviderManagedCacheReadinessTokens,
  isE2EAgentMetricsPassing,
} from './evaluateE2EAgentMetrics';
import { buildE2EAssessmentReport, type E2EAssessmentReport } from './e2eAssessmentReport';
import { lookupE2EScenarioBenchmarkMeta } from './e2eBenchmarkRegistry';
import { resolveE2EScenarioMaxRetries } from './e2eRetryPolicy';
import {
  buildE2EReadinessDashboard,
  E2E_READINESS_ARTIFACT_RETENTION_RUNS,
  E2E_READINESS_DASHBOARD_VERSION,
  formatE2EReadinessDashboardSummary,
  type E2EReadinessDashboard,
} from './e2eReadinessDashboard';
import {
  buildE2EScenarioTraceSummary,
  writeE2ERedactedTraceArtifacts,
  type E2ERunReportScenarioTraceArtifact,
  type E2EScenarioTraceSummary,
} from './e2eTraceArtifacts';
import {
  resolveE2EProviderBaseUrl,
  resolveE2EProviderKey,
  resolveE2EProviderModel,
  resolveE2EProviderSpec,
} from './providerConfig';
import { evaluateE2EScenarioRubrics } from './rubricEvaluators';
import {
  E2E_NATIVE_TOOL_FIXTURE_VERSION,
  E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
  E2E_PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE,
  E2E_SCENARIO_MANIFEST_VERSION,
  E2E_READINESS_MIN_FAST_SUITE_SCENARIO_COUNT,
  E2E_READINESS_MIN_AXIS_PASS_RATE,
  E2E_READINESS_MIN_PASS_RATE,
} from './thresholds';
import type { AcceptanceFixtureOutcome } from '../acceptanceMetrics/types';
import type { E2EAssessmentDimension } from './e2eAssessmentDimensions';
import type { E2EBenchmarkFamily } from './e2eBenchmarkRegistry';
import type {
  E2EPromptCachePrefixStability,
  E2EPromptCacheReasonCount,
  E2ERubric,
  E2EScenarioResult,
  E2ETokenUsageSummary,
} from './types';
import type { UsageTokenBuckets } from '../../types/usage';
import { buildPromptCachePrefixStability } from './tokenUsage';

export const E2E_REPORT_PATH_ENV = 'E2E_REPORT_PATH';
export const E2E_REPORT_PARTIAL_PATH_ENV = 'E2E_REPORT_PARTIAL_PATH';
export const E2E_READINESS_ARTIFACT_RETENTION_DIR_ENV = 'E2E_READINESS_ARTIFACT_RETENTION_DIR';
export const E2E_READINESS_ARTIFACT_RETENTION_LIMIT_ENV = 'E2E_READINESS_ARTIFACT_RETENTION_LIMIT';

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

const CRITICAL_READINESS_DIMENSIONS = new Set<E2EAssessmentDimension>([
  'tool_discovery',
  'memory',
  'control_graph',
  'mobile_native',
  'privacy_safety',
]);

const ASSISTANT_PROSE_RUBRIC_KIND_HINTS = new Set([
  'assistant_text',
  'assistant_contains',
  'assistant_regex',
  'final_text',
  'final_response',
  'response_contains',
]);

const WEAK_PATTERN_RUBRIC_KIND_HINTS = new Set(['regex', 'pattern', 'text_match']);

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return hash.toString(36);
}

function emptyUsageTokenBuckets(): UsageTokenBuckets {
  return {
    systemPromptTokens: 0,
    toolDeclarationTokens: 0,
    memoryContextTokens: 0,
    conversationHistoryTokens: 0,
    userTurnTokens: 0,
    toolResultTokens: 0,
  };
}

function resolveUsageTokenBuckets(usage: E2ETokenUsageSummary): UsageTokenBuckets {
  return usage.tokenBuckets ? { ...usage.tokenBuckets } : emptyUsageTokenBuckets();
}

function buildGoalEvidenceFingerprints(result: E2EScenarioResult): string[] {
  return result.graphSnapshots
    .map((snapshot) =>
      (snapshot.goals ?? [])
        .map((goal) => `${goal.id}:${goal.status}:${goal.evidence.join('|')}`)
        .sort()
        .join(';'),
    )
    .filter(Boolean);
}

function countCatalogResultsAfterActivation(result: E2EScenarioResult): number {
  const seenCatalogResultIds = new Set<string>();
  let activationSeen = false;
  let count = 0;

  for (const snapshot of result.graphSnapshots) {
    for (const toolResult of snapshot.observedToolResults ?? []) {
      if (toolResult.name !== 'tool_catalog' || seenCatalogResultIds.has(toolResult.id)) {
        continue;
      }
      seenCatalogResultIds.add(toolResult.id);
      if (activationSeen) {
        count += 1;
      }
    }

    if ((snapshot.sessionActivatedToolNames ?? []).length > 0) {
      activationSeen = true;
    }
  }

  return count;
}

function countHoldReasonEpisodes(
  snapshots: ReadonlyArray<E2EScenarioResult['graphSnapshots'][number]>,
): Map<string, number> {
  const holdReasonCounts = new Map<string, number>();
  let previousReason = '';

  for (const snapshot of snapshots) {
    const reason = snapshot.finalizationHoldReason?.trim() ?? '';
    if (!reason) {
      previousReason = '';
      continue;
    }
    if (reason === previousReason) {
      continue;
    }
    previousReason = reason;
    holdReasonCounts.set(reason, (holdReasonCounts.get(reason) ?? 0) + 1);
  }

  return holdReasonCounts;
}

function buildScenarioLoopDiagnostics(
  result: E2EScenarioResult,
): E2ERunReportScenarioLoopDiagnostics {
  const toolCounts = new Map<string, { name: string; argsHash: string; count: number }>();
  for (const call of result.toolCalls) {
    const name = call.name.trim();
    const argsHash = stableHash(call.arguments || '{}');
    const key = `${name}:${argsHash}`;
    const existing = toolCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      toolCounts.set(key, { name, argsHash, count: 1 });
    }
  }

  const evidenceFingerprints = buildGoalEvidenceFingerprints(result);
  const noNewEvidence =
    evidenceFingerprints.length === 0 || new Set(evidenceFingerprints).size <= 1;
  const repeatedToolCalls = Array.from(toolCounts.values())
    .filter((entry) => entry.count > 1)
    .map((entry) => ({
      ...entry,
      noNewEvidence,
    }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.argsHash.localeCompare(right.argsHash),
    );

  const repeatedCatalogAfterActivationCount = countCatalogResultsAfterActivation(result);

  const holdReasonCounts = countHoldReasonEpisodes(result.graphSnapshots);
  const repeatedHoldReasons = Array.from(holdReasonCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => left.reason.localeCompare(right.reason));

  return {
    repeatedToolCalls,
    repeatedCatalogAfterActivationCount,
    repeatedHoldReasons,
    passing:
      repeatedCatalogAfterActivationCount === 0 &&
      repeatedToolCalls.every((entry) => !entry.noNewEvidence || entry.count < 3) &&
      repeatedHoldReasons.every((entry) => entry.count < 3),
  };
}

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

function buildScenarioCacheSummary(result: E2EScenarioResult): E2ERunReportScenarioCache {
  const eligibleStats = estimateE2EEligibleCacheReadStats(result);
  const eligibleInputTokens = eligibleStats.eligibleInputTokens;
  const providerManagedReadinessTokens = estimateE2EProviderManagedCacheReadinessTokens(result);
  return {
    inputTokens: result.usage.inputTokens,
    eligibleInputTokens,
    providerManagedReadinessTokens,
    cacheReadTokens: result.usage.cacheReadTokens,
    cacheWriteTokens: result.usage.cacheWriteTokens,
    cacheReadRate: safeRate(result.usage.cacheReadTokens, result.usage.inputTokens),
    eligibleCacheReadRate: safeRate(eligibleStats.eligibleCacheReadTokens, eligibleInputTokens),
    eligible: eligibleInputTokens > 0,
  };
}

function buildRubricAudit(
  rubrics: ReadonlyArray<E2ERubric> | undefined,
): E2ERunReportScenarioRubricAudit {
  const risks: E2ERunReportRubricAuditRisk[] = [];
  let assistantProseRubricCount = 0;
  let weakPatternRubricCount = 0;
  let structuralSubstringRubricCount = 0;

  for (const rubric of rubrics ?? []) {
    const rubricKind = String((rubric as { kind: string }).kind);
    if (ASSISTANT_PROSE_RUBRIC_KIND_HINTS.has(rubricKind)) {
      assistantProseRubricCount += 1;
      risks.push({
        rubricKind,
        reason: 'assistant-prose grader is not benchmark-grade evidence',
      });
    }
    if (WEAK_PATTERN_RUBRIC_KIND_HINTS.has(rubricKind)) {
      weakPatternRubricCount += 1;
      risks.push({
        rubricKind,
        reason: 'pattern-matching grader is not structural evidence',
      });
    }
    if (
      (rubric.kind === 'workspace_file' && Boolean(rubric.contains)) ||
      rubric.kind === 'working_block_token' ||
      (rubric.kind === 'graph_audit_observed' && Boolean(rubric.detailContains))
    ) {
      structuralSubstringRubricCount += 1;
    }
  }

  return {
    rubricCount: rubrics?.length ?? 0,
    assistantProseRubricCount,
    weakPatternRubricCount,
    structuralSubstringRubricCount,
    risks,
  };
}

function buildRubricSummary(
  result: E2EScenarioResult,
  rubrics: ReadonlyArray<E2ERubric> | undefined,
): Pick<E2ERunReportScenarioEntry, 'rubricPassed' | 'rubricTotal' | 'failedRubrics'> {
  if (!rubrics?.length) {
    return {};
  }
  const rubricOutcomes = evaluateE2EScenarioRubrics(result, rubrics);
  const failedRubrics = rubricOutcomes
    .filter((outcome) => !outcome.passed)
    .map((outcome) => ({
      fixtureId: outcome.fixtureId,
      ...(outcome.detail ? { detail: outcome.detail } : {}),
    }));
  return {
    rubricPassed: rubricOutcomes.filter((outcome) => outcome.passed).length,
    rubricTotal: rubricOutcomes.length,
    ...(failedRubrics.length > 0 ? { failedRubrics } : {}),
  };
}

export function buildE2ERunReportScenarioEntry(params: {
  suite: string;
  result: E2EScenarioResult;
  outcome: AcceptanceFixtureOutcome;
  attemptCount: number;
  rubrics?: ReadonlyArray<E2ERubric>;
}): E2ERunReportScenarioEntry {
  const lastGraph = params.result.graphSnapshots[params.result.graphSnapshots.length - 1];
  const benchmarkMeta = lookupE2EScenarioBenchmarkMeta(params.result.fixtureId);
  return {
    suite: params.suite,
    fixtureId: params.result.fixtureId,
    passed: params.outcome.passed,
    attemptCount: params.attemptCount,
    durationMs: params.result.durationMs,
    completed: params.result.completed,
    userTurnCount: params.result.userTurnCount,
    toolCallCount: params.result.toolCalls.length,
    turnCount: params.result.turnTraces?.length ?? params.result.userTurnCount,
    graphStatus: lastGraph?.status ?? null,
    usage: params.result.usage,
    tokenBuckets: resolveUsageTokenBuckets(params.result.usage),
    cache: buildScenarioCacheSummary(params.result),
    ...(params.result.usage.promptCache ? { promptCache: params.result.usage.promptCache } : {}),
    loopDiagnostics: buildScenarioLoopDiagnostics(params.result),
    benchmarkFamilies: [...benchmarkMeta.benchmarkFamilies],
    assessmentDimensions: [...benchmarkMeta.assessmentDimensions],
    ...buildRubricSummary(params.result, params.rubrics),
    rubricAudit: buildRubricAudit(params.rubrics),
    trace: buildE2EScenarioTraceSummary({
      result: params.result,
      rubrics: params.rubrics,
    }),
    ...(params.outcome.detail ? { detail: params.outcome.detail } : {}),
    errors: params.result.errors,
  };
}

function buildPromptCacheTelemetryReport(
  entries: ReadonlyArray<E2ERunReportScenarioEntry>,
): E2ERunReportCacheSummary['promptCacheTelemetry'] {
  const scenarioPromptCache = entries
    .map((entry) => entry.promptCache)
    .filter((promptCache): promptCache is NonNullable<E2ERunReportScenarioEntry['promptCache']> =>
      Boolean(promptCache),
    );
  const reasonCounts = new Map<string, number>();
  const thresholdTokens = new Set<number>();
  const explicitCacheNames = new Set<string>();
  const promptCacheEvents = scenarioPromptCache.flatMap((promptCache) => promptCache.events);
  let eligibleTurnCount = 0;
  let enabledTurnCount = 0;
  let skippedTurnCount = 0;
  let createEventCount = 0;
  let reuseEventCount = 0;
  let providerManagedEventCount = 0;

  for (const promptCache of scenarioPromptCache) {
    eligibleTurnCount += promptCache.eligibleTurnCount;
    enabledTurnCount += promptCache.enabledTurnCount;
    skippedTurnCount += promptCache.skippedTurnCount;
    createEventCount += promptCache.createEventCount;
    reuseEventCount += promptCache.reuseEventCount;
    providerManagedEventCount += promptCache.providerManagedEventCount;
    for (const threshold of promptCache.thresholdTokens) {
      thresholdTokens.add(threshold);
    }
    for (const cacheName of promptCache.explicitCacheNames) {
      explicitCacheNames.add(cacheName);
    }
    for (const reasonCount of promptCache.reasonCounts) {
      reasonCounts.set(
        reasonCount.reason,
        (reasonCounts.get(reasonCount.reason) ?? 0) + reasonCount.count,
      );
    }
  }

  return {
    eligibleTurnCount,
    enabledTurnCount,
    skippedTurnCount,
    createEventCount,
    reuseEventCount,
    providerManagedEventCount,
    thresholdTokens: Array.from(thresholdTokens).sort((left, right) => left - right),
    explicitCacheNameCount: explicitCacheNames.size,
    reasonCounts: Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => left.reason.localeCompare(right.reason)),
    prefixStability: buildPromptCachePrefixStability(promptCacheEvents),
  };
}

function buildCacheReport(
  entries: ReadonlyArray<E2ERunReportScenarioEntry>,
  results?: ReadonlyArray<E2EScenarioResult>,
  cacheTelemetry: E2EPromptCacheCreateTelemetrySnapshot = {
    cacheCreateAttempts: 0,
    cacheCreateFailureCount: 0,
    cacheCreateFailuresByProviderStatus: [],
    cacheCreateTelemetryAvailable: true,
  },
): E2ERunReportCacheSummary {
  const resultByFixtureId = new Map((results ?? []).map((result) => [result.fixtureId, result]));
  const entryEligibleInputTokens = (entry: E2ERunReportScenarioEntry): number =>
    entry.cache?.eligibleInputTokens ??
    (entry.usage.inputTokens >= E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS
      ? entry.usage.inputTokens
      : 0);
  const entryEligibleStats = (entry: E2ERunReportScenarioEntry) => {
    const result = resultByFixtureId.get(entry.fixtureId);
    if (result) {
      return estimateE2EEligibleCacheReadStats(result);
    }
    const eligibleInputTokens = entryEligibleInputTokens(entry);
    return {
      eligibleInputTokens,
      eligibleCacheReadTokens: estimateEligibleCacheReadTokens(
        entry.usage.cacheReadTokens,
        eligibleInputTokens,
      ),
      eligibleTurnCount: eligibleInputTokens > 0 ? 1 : 0,
    };
  };

  const stats = results?.length
    ? buildE2EProgramCacheStats(results)
    : entries.reduce(
        (acc, entry) => ({
          inputTokens: acc.inputTokens + entry.usage.inputTokens,
          eligibleInputTokens: acc.eligibleInputTokens + entryEligibleInputTokens(entry),
          providerManagedReadinessTokens:
            acc.providerManagedReadinessTokens +
            estimateUsageProviderManagedCacheReadinessTokens(entry.usage),
          cacheReadTokens: acc.cacheReadTokens + entry.usage.cacheReadTokens,
          eligibleCacheReadTokens:
            acc.eligibleCacheReadTokens +
            estimateEligibleCacheReadTokens(
              entry.usage.cacheReadTokens,
              entryEligibleInputTokens(entry),
            ),
          cacheWriteTokens: acc.cacheWriteTokens + entry.usage.cacheWriteTokens,
          eligibleScenarioCount:
            acc.eligibleScenarioCount + (entryEligibleInputTokens(entry) > 0 ? 1 : 0),
          providerManagedReadinessObserved: false,
        }),
        {
          inputTokens: 0,
          eligibleInputTokens: 0,
          providerManagedReadinessTokens: 0,
          cacheReadTokens: 0,
          eligibleCacheReadTokens: 0,
          cacheWriteTokens: 0,
          eligibleScenarioCount: 0,
          providerManagedReadinessObserved: false,
        },
      );

  const eligibleCacheReadRate = safeRate(stats.eligibleCacheReadTokens, stats.eligibleInputTokens);
  const cacheReadRate = safeRate(stats.cacheReadTokens, stats.inputTokens);
  const providerManagedReadinessObserved =
    stats.providerManagedReadinessObserved ||
    (stats.eligibleInputTokens > 0 && stats.providerManagedReadinessTokens > 0);
  const passing =
    stats.eligibleInputTokens > 0 &&
    eligibleCacheReadRate >= E2E_PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE;

  return {
    inputTokens: stats.inputTokens,
    eligibleInputTokens: stats.eligibleInputTokens,
    providerManagedReadinessTokens: stats.providerManagedReadinessTokens,
    cacheReadTokens: stats.cacheReadTokens,
    cacheWriteTokens: stats.cacheWriteTokens,
    cacheReadRate,
    eligibleCacheReadRate,
    eligibleScenarioCount: stats.eligibleScenarioCount,
    eligibleInputThreshold: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
    targetEligibleCacheReadRate: E2E_PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE,
    providerManagedReadinessObserved,
    passing,
    cacheCreateAttempts: cacheTelemetry.cacheCreateAttempts,
    cacheCreateFailureCount: cacheTelemetry.cacheCreateFailureCount,
    cacheCreateFailuresByProviderStatus: cacheTelemetry.cacheCreateFailuresByProviderStatus,
    cacheCreateTelemetryAvailable: cacheTelemetry.cacheCreateTelemetryAvailable,
    promptCacheTelemetry: buildPromptCacheTelemetryReport(entries),
    scenarios: entries.map((entry) => {
      const eligibleStats = entryEligibleStats(entry);
      return {
        fixtureId: entry.fixtureId,
        inputTokens: entry.usage.inputTokens,
        eligibleInputTokens: eligibleStats.eligibleInputTokens,
        providerManagedReadinessTokens:
          entry.cache?.providerManagedReadinessTokens ??
          estimateUsageProviderManagedCacheReadinessTokens(entry.usage),
        cacheReadTokens: entry.usage.cacheReadTokens,
        cacheReadRate: safeRate(entry.usage.cacheReadTokens, entry.usage.inputTokens),
        eligibleCacheReadRate: safeRate(
          eligibleStats.eligibleCacheReadTokens,
          eligibleStats.eligibleInputTokens,
        ),
        tokenBuckets: entry.tokenBuckets,
        ...(entry.promptCache ? { promptCache: entry.promptCache } : {}),
      };
    }),
  };
}

function buildGraderAudit(
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

function buildReliabilityReport(
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

function buildReadinessReport(params: {
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
