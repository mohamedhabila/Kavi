import {
  buildE2EProgramCacheStats,
  estimateE2EEligibleCacheReadStats,
  estimateEligibleCacheReadTokens,
  estimateUsageProviderManagedCacheReadinessTokens,
} from './evaluateE2EAgentMetrics';
import { safeRate } from './e2eRunReportMath';
import type {
  E2EPromptCacheCreateTelemetrySnapshot,
  E2ERunReportCacheSummary,
  E2ERunReportScenarioEntry,
} from './e2eRunReport';
import {
  E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
  E2E_PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE,
} from './thresholds';
import { buildPromptCachePrefixStability } from './tokenUsage';
import type { E2EScenarioResult } from './types';

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

export function buildCacheReport(
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
