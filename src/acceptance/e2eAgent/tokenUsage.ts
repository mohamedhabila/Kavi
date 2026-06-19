// ---------------------------------------------------------------------------
// Kavi — E2E token usage aggregation
// ---------------------------------------------------------------------------

import type { TokenUsage } from '../../types/usage';
import type {
  E2EPromptCachePrefixStability,
  E2EPromptCacheSummary,
  E2ETokenUsageSummary,
} from './types';

const EMPTY_TOKEN_BUCKETS = {
  systemPromptTokens: 0,
  toolDeclarationTokens: 0,
  memoryContextTokens: 0,
  conversationHistoryTokens: 0,
  userTurnTokens: 0,
  toolResultTokens: 0,
};

function buildPromptCacheSummary(
  events: ReadonlyArray<TokenUsage>,
): E2EPromptCacheSummary | undefined {
  const promptCacheEvents = events
    .map((event) => event.promptCache)
    .filter((event): event is NonNullable<TokenUsage['promptCache']> => Boolean(event));

  if (promptCacheEvents.length === 0) {
    return undefined;
  }

  const reasonCounts = new Map<string, number>();
  for (const event of promptCacheEvents) {
    const reason = event.reason.trim() || 'unknown';
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }

  return {
    eligibleTurnCount: promptCacheEvents.filter((event) => event.eligible).length,
    enabledTurnCount: promptCacheEvents.filter((event) => event.enabled).length,
    skippedTurnCount: promptCacheEvents.filter((event) => event.event === 'skip').length,
    createEventCount: promptCacheEvents.filter((event) => event.event === 'create').length,
    reuseEventCount: promptCacheEvents.filter((event) => event.event === 'reuse').length,
    providerManagedEventCount: promptCacheEvents.filter(
      (event) => event.event === 'provider_managed',
    ).length,
    thresholdTokens: Array.from(new Set(promptCacheEvents.map((event) => event.thresholdTokens)))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right),
    explicitCacheNames: Array.from(
      new Set(promptCacheEvents.map((event) => event.explicitCacheName).filter(Boolean)),
    ).sort() as string[],
    reasonCounts: Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => left.reason.localeCompare(right.reason)),
    prefixStability: buildPromptCachePrefixStability(promptCacheEvents),
    events: promptCacheEvents.map((event) => ({ ...event })),
  };
}

function longestRun(values: ReadonlyArray<string>): number {
  let longest = 0;
  let current = 0;
  let previous = '';
  for (const value of values) {
    if (!value) {
      current = 0;
      previous = '';
      continue;
    }
    current = value === previous ? current + 1 : 1;
    previous = value;
    longest = Math.max(longest, current);
  }
  return longest;
}

export function buildPromptCachePrefixStability(
  events: ReadonlyArray<NonNullable<TokenUsage['promptCache']>>,
): E2EPromptCachePrefixStability {
  const stableSystemPromptDigests = events.map(
    (event) => event.stableSystemPromptDigest?.trim() ?? '',
  );
  const stableToolDigests = events.map(
    (event) => event.stableToolDeclarationDigest?.trim() ?? '',
  );
  const prefixDigests = events.map((event) => event.cacheablePrefixDigest?.trim() ?? '');
  const toolDigests = events.map((event) => event.toolDeclarationDigest?.trim() ?? '');
  const nonEmptyStableSystemPromptDigests = stableSystemPromptDigests.filter(Boolean);
  const nonEmptyStableToolDigests = stableToolDigests.filter(Boolean);
  const nonEmptyPrefixDigests = prefixDigests.filter(Boolean);
  const nonEmptyToolDigests = toolDigests.filter(Boolean);
  const eventCount = events.length;

  return {
    eventCount,
    stableSystemPromptDigestEventCount: nonEmptyStableSystemPromptDigests.length,
    stableToolDeclarationDigestEventCount: nonEmptyStableToolDigests.length,
    cacheablePrefixDigestEventCount: nonEmptyPrefixDigests.length,
    toolDeclarationDigestEventCount: nonEmptyToolDigests.length,
    uniqueStableSystemPromptDigestCount: new Set(nonEmptyStableSystemPromptDigests).size,
    uniqueStableToolDeclarationDigestCount: new Set(nonEmptyStableToolDigests).size,
    uniqueCacheablePrefixDigestCount: new Set(nonEmptyPrefixDigests).size,
    uniqueToolDeclarationDigestCount: new Set(nonEmptyToolDigests).size,
    stableSystemPromptDigestPerEvent:
      eventCount > 0 ? new Set(nonEmptyStableSystemPromptDigests).size / eventCount : 0,
    stableToolDeclarationDigestPerEvent:
      eventCount > 0 ? new Set(nonEmptyStableToolDigests).size / eventCount : 0,
    cacheablePrefixDigestPerEvent:
      eventCount > 0 ? new Set(nonEmptyPrefixDigests).size / eventCount : 0,
    toolDeclarationDigestPerEvent:
      eventCount > 0 ? new Set(nonEmptyToolDigests).size / eventCount : 0,
    longestStableSystemPromptRun: longestRun(stableSystemPromptDigests),
    longestStableToolDeclarationRun: longestRun(stableToolDigests),
    longestCacheablePrefixRun: longestRun(prefixDigests),
    longestToolDeclarationRun: longestRun(toolDigests),
  };
}

export function aggregateE2ETokenUsage(events: ReadonlyArray<TokenUsage>): E2ETokenUsageSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  const tokenBuckets = { ...EMPTY_TOKEN_BUCKETS };
  let sawTokenBuckets = false;

  for (const event of events) {
    inputTokens += event.inputTokens ?? 0;
    outputTokens += event.outputTokens ?? 0;
    cacheReadTokens += event.cacheReadTokens ?? 0;
    cacheWriteTokens += event.cacheWriteTokens ?? 0;
    if (event.tokenBuckets) {
      sawTokenBuckets = true;
      tokenBuckets.systemPromptTokens += event.tokenBuckets.systemPromptTokens;
      tokenBuckets.toolDeclarationTokens += event.tokenBuckets.toolDeclarationTokens;
      tokenBuckets.memoryContextTokens += event.tokenBuckets.memoryContextTokens;
      tokenBuckets.conversationHistoryTokens += event.tokenBuckets.conversationHistoryTokens;
      tokenBuckets.userTurnTokens += event.tokenBuckets.userTurnTokens;
      tokenBuckets.toolResultTokens += event.tokenBuckets.toolResultTokens;
    }
  }

  const promptCache = buildPromptCacheSummary(events);

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens,
    eventCount: events.length,
    ...(sawTokenBuckets ? { tokenBuckets } : {}),
    ...(promptCache ? { promptCache } : {}),
  };
}
