// ---------------------------------------------------------------------------
// Kavi — E2E agent metric evaluation entry point
// ---------------------------------------------------------------------------

import {
  aggregateAcceptanceMetrics,
  buildPassRateSummary,
  isSummaryPassing,
} from '../acceptanceMetrics/aggregateResults';
import type {
  AcceptanceFixtureOutcome,
  AcceptanceMetricEvaluation,
  AcceptanceMetricSummary,
} from '../acceptanceMetrics/types';
import {
  E2E_PROGRAM_MAX_TOTAL_TOKENS,
  E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
  E2E_PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE,
  E2E_SCENARIO_MIN_PASS_RATE,
} from './thresholds';
import type { E2EScenarioResult, E2ETokenUsageSummary } from './types';
import type { UsagePromptCacheTelemetry } from '../../types/usage';

export type E2EProgramCacheStats = {
  inputTokens: number;
  eligibleInputTokens: number;
  providerManagedReadinessTokens: number;
  cacheReadTokens: number;
  eligibleCacheReadTokens: number;
  cacheWriteTokens: number;
  cacheReadRate: number;
  eligibleCacheReadRate: number;
  eligibleScenarioCount: number;
  providerManagedReadinessObserved: boolean;
};

export type E2EEligibleCacheReadStats = {
  eligibleInputTokens: number;
  eligibleCacheReadTokens: number;
  eligibleTurnCount: number;
};

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function estimateEligibleCacheReadTokens(
  cacheReadTokens: number,
  eligibleInputTokens: number,
): number {
  return Math.min(Math.max(0, cacheReadTokens), Math.max(0, eligibleInputTokens));
}

export function estimateE2ECacheEligibleInputTokens(result: E2EScenarioResult): number {
  return estimateE2EEligibleCacheReadStats(result).eligibleInputTokens;
}

function buildPromptCacheOpportunityKey(event: UsagePromptCacheTelemetry): string {
  const explicitCacheName = event.explicitCacheName?.trim();
  if (explicitCacheName) {
    return `${event.mode}:explicit:${explicitCacheName}`;
  }

  const cacheablePrefixDigest = event.cacheablePrefixDigest?.trim();
  if (!cacheablePrefixDigest) {
    return '';
  }

  return `${event.mode}:provider:${cacheablePrefixDigest}`;
}

function estimatePromptCacheReadOpportunityTokens(
  events: ReadonlyArray<UsagePromptCacheTelemetry>,
): number {
  const seenKeys = new Set<string>();
  let sawUnkeyedEligibleEvent = false;
  let tokens = 0;

  for (const event of events) {
    if (!event.eligible) {
      continue;
    }

    const estimatedInputTokens = Math.max(0, event.estimatedInputTokens);
    if (event.event === 'reuse') {
      tokens += estimatedInputTokens;
      continue;
    }

    const key = buildPromptCacheOpportunityKey(event);
    if (!key) {
      if (sawUnkeyedEligibleEvent) {
        tokens += estimatedInputTokens;
      }
      sawUnkeyedEligibleEvent = true;
      continue;
    }

    if (seenKeys.has(key)) {
      tokens += estimatedInputTokens;
      continue;
    }
    seenKeys.add(key);
  }

  return tokens;
}

function isProviderManagedReadinessEvent(event: UsagePromptCacheTelemetry): boolean {
  return (
    event.event === 'provider_managed' &&
    event.eligible &&
    event.enabled &&
    buildPromptCacheOpportunityKey(event).length > 0
  );
}

function estimateProviderManagedCacheReadinessTokens(
  events: ReadonlyArray<UsagePromptCacheTelemetry>,
): number {
  const seenKeys = new Set<string>();
  let tokens = 0;

  for (const event of events) {
    if (!isProviderManagedReadinessEvent(event)) {
      continue;
    }

    const key = buildPromptCacheOpportunityKey(event);
    if (seenKeys.has(key)) {
      tokens += Math.max(0, event.estimatedInputTokens);
      continue;
    }
    seenKeys.add(key);
  }

  return tokens;
}

export function estimateUsageCacheEligibleInputTokens(usage: E2ETokenUsageSummary): number {
  if (usage.promptCache) {
    const providerEligibleTokens = estimatePromptCacheReadOpportunityTokens(
      usage.promptCache.events,
    );
    return Math.min(Math.max(0, usage.inputTokens), providerEligibleTokens);
  }

  return usage.inputTokens >= E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS ? usage.inputTokens : 0;
}

type PromptCacheOpportunityState = {
  seenKeys: Set<string>;
  sawUnkeyedEligibleEvent: boolean;
};

function estimateUsageCacheEligibleInputTokensWithState(
  usage: E2ETokenUsageSummary,
  state: PromptCacheOpportunityState,
): number {
  if (!usage.promptCache) {
    return estimateUsageCacheEligibleInputTokens(usage);
  }

  let eligibleEventCount = 0;
  let eligibleEstimatedTokens = 0;
  let eligibleTotalEventCount = 0;

  for (const event of usage.promptCache.events) {
    if (!event.eligible) {
      continue;
    }
    eligibleTotalEventCount += 1;

    const estimatedInputTokens = Math.max(0, event.estimatedInputTokens);
    let eligibleForRead = event.event === 'reuse' || usage.cacheReadTokens > 0;

    if (!eligibleForRead) {
      const key = buildPromptCacheOpportunityKey(event);
      if (!key) {
        eligibleForRead = state.sawUnkeyedEligibleEvent;
        state.sawUnkeyedEligibleEvent = true;
      } else if (state.seenKeys.has(key)) {
        eligibleForRead = true;
      } else {
        state.seenKeys.add(key);
      }
    }

    if (eligibleForRead) {
      eligibleEventCount += 1;
      eligibleEstimatedTokens += estimatedInputTokens;
    }
  }

  if (eligibleEventCount === 0) {
    return 0;
  }

  const inputTokens = Math.max(0, usage.inputTokens);
  return inputTokens > 0 && eligibleEventCount === eligibleTotalEventCount
    ? inputTokens
    : eligibleEstimatedTokens;
}

export function estimateE2EEligibleCacheReadStats(
  result: E2EScenarioResult,
): E2EEligibleCacheReadStats {
  const usageBuckets =
    result.turnTraces.length > 0
      ? result.turnTraces
          .slice()
          .sort((left, right) => left.turnIndex - right.turnIndex)
          .map((trace) => trace.usage)
      : [result.usage];
  const state: PromptCacheOpportunityState = {
    seenKeys: new Set<string>(),
    sawUnkeyedEligibleEvent: false,
  };
  let eligibleInputTokens = 0;
  let eligibleCacheReadTokens = 0;
  let eligibleTurnCount = 0;

  for (const usage of usageBuckets) {
    const bucketEligibleInputTokens = estimateUsageCacheEligibleInputTokensWithState(usage, state);
    if (bucketEligibleInputTokens <= 0) {
      continue;
    }

    eligibleInputTokens += bucketEligibleInputTokens;
    eligibleCacheReadTokens += estimateEligibleCacheReadTokens(
      usage.cacheReadTokens,
      bucketEligibleInputTokens,
    );
    eligibleTurnCount += 1;
  }

  return { eligibleInputTokens, eligibleCacheReadTokens, eligibleTurnCount };
}

export function estimateUsageProviderManagedCacheReadinessTokens(
  usage: E2ETokenUsageSummary,
): number {
  return usage.promptCache
    ? Math.min(
        Math.max(0, usage.inputTokens),
        estimateProviderManagedCacheReadinessTokens(usage.promptCache.events),
      )
    : 0;
}

export function estimateE2EProviderManagedCacheReadinessTokens(result: E2EScenarioResult): number {
  if (result.usage.promptCache) {
    return estimateUsageProviderManagedCacheReadinessTokens(result.usage);
  }

  const usageBuckets =
    result.turnTraces.length > 0 ? result.turnTraces.map((trace) => trace.usage) : [result.usage];

  return usageBuckets.reduce(
    (sum, usage) => sum + estimateUsageProviderManagedCacheReadinessTokens(usage),
    0,
  );
}

export function buildE2EProgramCacheStats(
  results: ReadonlyArray<E2EScenarioResult>,
): E2EProgramCacheStats {
  const inputTokens = results.reduce((sum, result) => sum + result.usage.inputTokens, 0);
  const cacheReadTokens = results.reduce((sum, result) => sum + result.usage.cacheReadTokens, 0);
  const cacheWriteTokens = results.reduce((sum, result) => sum + result.usage.cacheWriteTokens, 0);
  const scenarioEligibleStats = results.map((result) => estimateE2EEligibleCacheReadStats(result));
  const scenarioProviderManagedReadiness = results.map((result) =>
    estimateE2EProviderManagedCacheReadinessTokens(result),
  );
  const eligibleInputTokens = scenarioEligibleStats.reduce(
    (sum, stats) => sum + stats.eligibleInputTokens,
    0,
  );
  const eligibleCacheReadTokens = scenarioEligibleStats.reduce(
    (sum, stats) => sum + stats.eligibleCacheReadTokens,
    0,
  );
  const providerManagedReadinessTokens = scenarioProviderManagedReadiness.reduce(
    (sum, tokens) => sum + tokens,
    0,
  );
  const eligibleScenarioCount = scenarioEligibleStats.filter(
    (stats) => stats.eligibleInputTokens > 0,
  ).length;
  const providerManagedReadinessObserved =
    eligibleInputTokens > 0 && providerManagedReadinessTokens > 0;

  return {
    inputTokens,
    eligibleInputTokens,
    providerManagedReadinessTokens,
    cacheReadTokens,
    eligibleCacheReadTokens,
    cacheWriteTokens,
    cacheReadRate: safeRate(cacheReadTokens, inputTokens),
    eligibleCacheReadRate: safeRate(eligibleCacheReadTokens, eligibleInputTokens),
    eligibleScenarioCount,
    providerManagedReadinessObserved,
  };
}

export function buildE2EScenarioPassRateSummary(
  outcomes: ReadonlyArray<AcceptanceFixtureOutcome>,
): AcceptanceMetricSummary {
  return buildPassRateSummary({
    metricId: 'e2e-agent-scenarios',
    label: 'E2E agent scenario pass rate',
    outcomes,
    targetRate: E2E_SCENARIO_MIN_PASS_RATE,
    comparator: 'min',
  });
}

export function buildE2EProgramCacheUtilizationSummary(
  results: ReadonlyArray<E2EScenarioResult>,
): AcceptanceMetricSummary {
  const stats = buildE2EProgramCacheStats(results);
  const passed =
    stats.eligibleInputTokens > 0 &&
    stats.eligibleCacheReadRate >= E2E_PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE;
  const detail =
    stats.eligibleInputTokens === 0
      ? `no cache-eligible input buckets >= ${E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS} tokens`
      : [
          `eligibleCacheReadRate=${stats.eligibleCacheReadRate.toFixed(3)}`,
          `target=${E2E_PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE.toFixed(3)}`,
          `providerManagedReadinessTokens=${stats.providerManagedReadinessTokens}`,
          `cacheReadTokens=${stats.cacheReadTokens}`,
          `eligibleInputTokens=${stats.eligibleInputTokens}`,
        ].join(' ');

  return {
    metricId: 'e2e-program-cache-utilization',
    label: 'E2E program prompt cache utilization',
    passed: passed ? results.length : 0,
    total: results.length,
    passRate: passed ? 1 : 0,
    targetRate: 1,
    comparator: 'min',
    outcomes: results.map((result) => ({
      fixtureId: result.fixtureId,
      passed,
      detail,
    })),
  };
}

export function buildE2EProgramTokenBudgetSummary(
  results: ReadonlyArray<E2EScenarioResult>,
): AcceptanceMetricSummary {
  const totalTokens = results.reduce((sum, result) => sum + result.usage.totalTokens, 0);
  const withinBudget = totalTokens <= E2E_PROGRAM_MAX_TOTAL_TOKENS;

  return {
    metricId: 'e2e-program-token-budget',
    label: 'E2E program total token budget',
    passed: withinBudget ? results.length : 0,
    total: results.length,
    passRate: withinBudget ? 1 : 0,
    targetRate: 1,
    comparator: 'min',
    outcomes: results.map((result) => ({
      fixtureId: result.fixtureId,
      passed: withinBudget,
      detail: withinBudget
        ? `program total ${totalTokens} <= ${E2E_PROGRAM_MAX_TOTAL_TOKENS}`
        : `program total ${totalTokens} exceeds ${E2E_PROGRAM_MAX_TOTAL_TOKENS}`,
    })),
  };
}

export function evaluateE2EAgentOutcomes(
  outcomes: ReadonlyArray<AcceptanceFixtureOutcome>,
  results?: ReadonlyArray<E2EScenarioResult>,
  options?: { includeProgramCacheUtilization?: boolean },
): AcceptanceMetricEvaluation {
  const summaries = [buildE2EScenarioPassRateSummary(outcomes)];
  if (results?.length) {
    summaries.push(buildE2EProgramTokenBudgetSummary(results));
    if (options?.includeProgramCacheUtilization !== false && results.length > 0) {
      summaries.push(buildE2EProgramCacheUtilizationSummary(results));
    }
  }
  return aggregateAcceptanceMetrics(summaries);
}

export function isE2EAgentMetricsPassing(evaluation: AcceptanceMetricEvaluation): boolean {
  return evaluation.summaries.every(isSummaryPassing);
}

export function formatE2ETokenUsageReport(results: ReadonlyArray<E2EScenarioResult>): string {
  const lines = results.map((result) => {
    const usage = result.usage;
    const fields = [
      result.fixtureId,
      `in=${usage.inputTokens}`,
      `eligibleIn=${estimateE2ECacheEligibleInputTokens(result)}`,
      `out=${usage.outputTokens}`,
      `cacheR=${usage.cacheReadTokens}`,
      `cacheRate=${safeRate(usage.cacheReadTokens, usage.inputTokens).toFixed(3)}`,
      `cacheW=${usage.cacheWriteTokens}`,
      `total=${usage.totalTokens}`,
      `ms=${result.durationMs}`,
    ];
    if (usage.tokenBuckets) {
      fields.push(
        `buckets=sys:${usage.tokenBuckets.systemPromptTokens},tools:${usage.tokenBuckets.toolDeclarationTokens},memory:${usage.tokenBuckets.memoryContextTokens},history:${usage.tokenBuckets.conversationHistoryTokens},user:${usage.tokenBuckets.userTurnTokens},results:${usage.tokenBuckets.toolResultTokens}`,
      );
    }
    if (usage.promptCache) {
      fields.push(
        `promptCache=eligible:${usage.promptCache.eligibleTurnCount},enabled:${usage.promptCache.enabledTurnCount},create:${usage.promptCache.createEventCount},reuse:${usage.promptCache.reuseEventCount},managed:${usage.promptCache.providerManagedEventCount},skip:${usage.promptCache.skippedTurnCount}`,
      );
    }
    return fields.join(' ');
  });
  return lines.join('\n');
}
