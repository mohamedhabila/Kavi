import type { UsagePromptCacheTelemetry, UsageTokenBuckets } from '../../types/usage';
import type { E2EPromptCacheSummary, E2ETokenUsageSummary } from './types';
import { hashString, type E2ERedactedHash } from './e2eTraceRedaction';

export type E2ERedactedPromptCacheEvent = Omit<
  UsagePromptCacheTelemetry,
  'explicitCacheName'
> & {
  explicitCacheNameHash?: E2ERedactedHash;
};

export type E2ERedactedPromptCacheTrace = Omit<
  E2EPromptCacheSummary,
  'events' | 'explicitCacheNames'
> & {
  explicitCacheNameHashes: E2ERedactedHash[];
  events: E2ERedactedPromptCacheEvent[];
};

export type E2ERedactedUsageTrace = Omit<E2ETokenUsageSummary, 'promptCache'> & {
  tokenBuckets?: UsageTokenBuckets;
  promptCache?: E2ERedactedPromptCacheTrace;
};

function buildPromptCacheTrace(
  promptCache: E2EPromptCacheSummary | undefined,
): E2ERedactedPromptCacheTrace | undefined {
  if (!promptCache) {
    return undefined;
  }
  return {
    eligibleTurnCount: promptCache.eligibleTurnCount,
    enabledTurnCount: promptCache.enabledTurnCount,
    skippedTurnCount: promptCache.skippedTurnCount,
    createEventCount: promptCache.createEventCount,
    reuseEventCount: promptCache.reuseEventCount,
    providerManagedEventCount: promptCache.providerManagedEventCount,
    thresholdTokens: [...promptCache.thresholdTokens],
    explicitCacheNameHashes: promptCache.explicitCacheNames.map(hashString),
    reasonCounts: [...promptCache.reasonCounts],
    ...(promptCache.prefixStability ? { prefixStability: promptCache.prefixStability } : {}),
    events: promptCache.events.map((event) => ({
      eligible: event.eligible,
      enabled: event.enabled,
      estimatedInputTokens: event.estimatedInputTokens,
      thresholdTokens: event.thresholdTokens,
      providerFamily: event.providerFamily,
      ...(event.hostedFamily ? { hostedFamily: event.hostedFamily } : {}),
      mode: event.mode,
      event: event.event,
      reason: event.reason,
      ...(event.explicitCacheName
        ? { explicitCacheNameHash: hashString(event.explicitCacheName) }
        : {}),
      ...(event.stableSystemPromptDigest
        ? { stableSystemPromptDigest: event.stableSystemPromptDigest }
        : {}),
      ...(event.stableToolDeclarationDigest
        ? { stableToolDeclarationDigest: event.stableToolDeclarationDigest }
        : {}),
      ...(event.cacheablePrefixDigest
        ? { cacheablePrefixDigest: event.cacheablePrefixDigest }
        : {}),
      ...(event.toolDeclarationDigest
        ? { toolDeclarationDigest: event.toolDeclarationDigest }
        : {}),
      ...(event.prefixDivergenceReason
        ? { prefixDivergenceReason: event.prefixDivergenceReason }
        : {}),
    })),
  };
}

export function buildUsageTrace(usage: E2ETokenUsageSummary): E2ERedactedUsageTrace {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    eventCount: usage.eventCount,
    ...(usage.tokenBuckets ? { tokenBuckets: { ...usage.tokenBuckets } } : {}),
    ...(usage.promptCache ? { promptCache: buildPromptCacheTrace(usage.promptCache) } : {}),
  };
}
