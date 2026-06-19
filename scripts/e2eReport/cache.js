const {
  EMPTY_TOKEN_BUCKETS,
  PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
  PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE,
} = require('./constants');
const {
  parseNonNegativeInteger,
  readCacheCreateTelemetryFromEnv,
  safeRate,
  eligibleCacheReadTokens,
  scenarioEligibleInputTokens,
} = require('./parser');

function buildCache(entries) {
  const cacheCreateTelemetry = readCacheCreateTelemetryFromEnv();
  const promptCacheTelemetry = buildPromptCacheTelemetry(entries);
  const summary = entries.reduce(
    (acc, entry) => {
      const eligibleInputTokens = scenarioEligibleInputTokens(entry);
      return {
        inputTokens: acc.inputTokens + (entry.usage?.inputTokens ?? 0),
        eligibleInputTokens: acc.eligibleInputTokens + eligibleInputTokens,
        cacheReadTokens: acc.cacheReadTokens + (entry.usage?.cacheReadTokens ?? 0),
        eligibleCacheReadTokens:
          acc.eligibleCacheReadTokens +
          eligibleCacheReadTokens(entry.usage?.cacheReadTokens ?? 0, eligibleInputTokens),
        cacheWriteTokens: acc.cacheWriteTokens + (entry.usage?.cacheWriteTokens ?? 0),
        eligibleScenarioCount: acc.eligibleScenarioCount + (eligibleInputTokens > 0 ? 1 : 0),
      };
    },
    {
      inputTokens: 0,
      eligibleInputTokens: 0,
      cacheReadTokens: 0,
      eligibleCacheReadTokens: 0,
      cacheWriteTokens: 0,
      eligibleScenarioCount: 0,
    },
  );
  const eligibleCacheReadRate = safeRate(
    summary.eligibleCacheReadTokens,
    summary.eligibleInputTokens,
  );

  return {
    ...summary,
    cacheReadRate: safeRate(summary.cacheReadTokens, summary.inputTokens),
    eligibleCacheReadRate,
    eligibleInputThreshold: PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
    targetEligibleCacheReadRate: PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE,
    passing:
      summary.eligibleInputTokens > 0 &&
      eligibleCacheReadRate >= PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE,
    cacheCreateAttempts: cacheCreateTelemetry.cacheCreateAttempts,
    cacheCreateFailureCount: cacheCreateTelemetry.cacheCreateFailureCount,
    cacheCreateFailuresByProviderStatus: cacheCreateTelemetry.cacheCreateFailuresByProviderStatus,
    cacheCreateTelemetryAvailable: cacheCreateTelemetry.cacheCreateTelemetryAvailable,
    promptCacheTelemetry,
    scenarios: entries.map((entry) => ({
      fixtureId: entry.fixtureId,
      inputTokens: entry.usage?.inputTokens ?? 0,
      eligibleInputTokens: scenarioEligibleInputTokens(entry),
      cacheReadTokens: entry.usage?.cacheReadTokens ?? 0,
      cacheReadRate: safeRate(entry.usage?.cacheReadTokens ?? 0, entry.usage?.inputTokens ?? 0),
      eligibleCacheReadRate: safeRate(
        eligibleCacheReadTokens(
          entry.usage?.cacheReadTokens ?? 0,
          scenarioEligibleInputTokens(entry),
        ),
        scenarioEligibleInputTokens(entry),
      ),
      tokenBuckets: entry.tokenBuckets ?? entry.usage?.tokenBuckets ?? EMPTY_TOKEN_BUCKETS,
      ...((entry.promptCache ?? entry.usage?.promptCache)
        ? { promptCache: entry.promptCache ?? entry.usage.promptCache }
        : {}),
    })),
  };
}

function buildPromptCacheTelemetry(entries) {
  const reasonCounts = new Map();
  const thresholdTokens = new Set();
  const explicitCacheNames = new Set();
  const totals = {
    eligibleTurnCount: 0,
    enabledTurnCount: 0,
    skippedTurnCount: 0,
    createEventCount: 0,
    reuseEventCount: 0,
    providerManagedEventCount: 0,
  };

  for (const entry of entries) {
    const promptCache = entry.promptCache ?? entry.usage?.promptCache;
    if (!promptCache) {
      continue;
    }
    totals.eligibleTurnCount += promptCache.eligibleTurnCount ?? 0;
    totals.enabledTurnCount += promptCache.enabledTurnCount ?? 0;
    totals.skippedTurnCount += promptCache.skippedTurnCount ?? 0;
    totals.createEventCount += promptCache.createEventCount ?? 0;
    totals.reuseEventCount += promptCache.reuseEventCount ?? 0;
    totals.providerManagedEventCount += promptCache.providerManagedEventCount ?? 0;
    for (const threshold of promptCache.thresholdTokens ?? []) {
      if (Number.isFinite(threshold)) {
        thresholdTokens.add(threshold);
      }
    }
    for (const cacheName of promptCache.explicitCacheNames ?? []) {
      if (cacheName) {
        explicitCacheNames.add(cacheName);
      }
    }
    for (const reasonCount of promptCache.reasonCounts ?? []) {
      const reason = String(reasonCount.reason ?? '').trim();
      const count = parseNonNegativeInteger(String(reasonCount.count ?? '')) ?? 0;
      if (reason && count > 0) {
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + count);
      }
    }
  }

  return {
    ...totals,
    thresholdTokens: Array.from(thresholdTokens).sort((left, right) => left - right),
    explicitCacheNameCount: explicitCacheNames.size,
    reasonCounts: Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => left.reason.localeCompare(right.reason)),
  };
}

module.exports = {
  buildCache,
  buildPromptCacheTelemetry,
};
