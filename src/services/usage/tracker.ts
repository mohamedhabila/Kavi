import type { NormalizedUsage, SessionUsage, TokenUsage } from '../../types/usage';
import { estimateCost } from './usagePricing';

// ---------------------------------------------------------------------------
// Usage Tracker
// ---------------------------------------------------------------------------
// Tracks cumulative session usage, cache summary reporting, and public tracker
// compatibility exports.

type CacheUsageSummary = {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheDenominatorTokens: number;
};

export { normalizeUsage } from './usageNormalization';
export { estimateCost, isZeroCostModel } from './usagePricing';

export function getUsageCacheSummary(
  usage: Partial<Pick<NormalizedUsage, 'inputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>>,
): CacheUsageSummary {
  const cacheReadTokens = Math.max(0, usage.cacheReadTokens ?? 0);
  const cacheWriteTokens = Math.max(0, usage.cacheWriteTokens ?? 0);
  const cacheDenominatorTokens = Math.max(
    0,
    usage.inputTokens ?? 0,
    cacheReadTokens,
    cacheWriteTokens,
  );

  return {
    cacheReadTokens,
    cacheWriteTokens,
    cacheDenominatorTokens,
  };
}

// ── Session usage tracking ───────────────────────────────────────────────

const sessionUsageMap = new Map<string, SessionUsage>();
const MAX_TRACKED_SESSIONS = 100;

export function recordUsage(conversationId: string, usage: TokenUsage): void {
  let session = sessionUsageMap.get(conversationId);
  if (!session) {
    // Evict oldest sessions if at capacity
    if (sessionUsageMap.size >= MAX_TRACKED_SESSIONS) {
      const oldestKey = sessionUsageMap.keys().next().value;
      if (oldestKey) sessionUsageMap.delete(oldestKey);
    }
    session = {
      conversationId,
      entries: [],
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalCost: 0,
    };
    sessionUsageMap.set(conversationId, session);
  }

  const cost = estimateCost(usage.model, usage.inputTokens, usage.outputTokens, {
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    tokenDetails: usage.tokenDetails,
  });

  session.entries.push({
    model: usage.model,
    provider: '',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    ...(usage.tokenBuckets ? { tokenBuckets: usage.tokenBuckets } : {}),
    ...(usage.promptCache ? { promptCache: usage.promptCache } : {}),
    timestamp: Date.now(),
    estimatedCost: cost,
  });

  session.totalInput += usage.inputTokens;
  session.totalOutput += usage.outputTokens;
  session.totalCacheRead = (session.totalCacheRead || 0) + (usage.cacheReadTokens ?? 0);
  session.totalCacheWrite = (session.totalCacheWrite || 0) + (usage.cacheWriteTokens ?? 0);
  session.totalCost += cost;
}

export function getSessionUsage(conversationId: string): SessionUsage | undefined {
  return sessionUsageMap.get(conversationId);
}

export function getAllSessionUsages(): SessionUsage[] {
  return Array.from(sessionUsageMap.values());
}

export function getTotalUsage(): {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
} {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;
  for (const session of sessionUsageMap.values()) {
    totalInput += session.totalInput;
    totalOutput += session.totalOutput;
    totalCacheRead += session.totalCacheRead || 0;
    totalCacheWrite += session.totalCacheWrite || 0;
    totalCost += session.totalCost;
  }
  return { totalInput, totalOutput, totalCacheRead, totalCacheWrite, totalCost };
}

export function formatUsageReport(conversationId?: string): string {
  if (conversationId) {
    const session = sessionUsageMap.get(conversationId);
    if (!session) return 'No usage data for this session.';

    const lines = [
      '**Session Usage**',
      `- Input tokens: ${session.totalInput.toLocaleString()}`,
      `- Output tokens: ${session.totalOutput.toLocaleString()}`,
      `- Cache read tokens: ${(session.totalCacheRead || 0).toLocaleString()}`,
      `- Cache write tokens: ${(session.totalCacheWrite || 0).toLocaleString()}`,
      `- Estimated cost: $${session.totalCost.toFixed(4)}`,
      `- API calls: ${session.entries.length}`,
    ];

    if (session.entries.length > 0) {
      const last = session.entries[session.entries.length - 1];
      lines.push(`- Last model: ${last.model}`);
    }

    return lines.join('\n');
  }

  const total = getTotalUsage();
  const sessions = getAllSessionUsages();
  return [
    '**Total Usage**',
    `- Sessions: ${sessions.length}`,
    `- Input tokens: ${total.totalInput.toLocaleString()}`,
    `- Output tokens: ${total.totalOutput.toLocaleString()}`,
    `- Cache read tokens: ${total.totalCacheRead.toLocaleString()}`,
    `- Cache write tokens: ${total.totalCacheWrite.toLocaleString()}`,
    `- Total estimated cost: $${total.totalCost.toFixed(4)}`,
  ].join('\n');
}

export function clearUsageData(): void {
  sessionUsageMap.clear();
}
