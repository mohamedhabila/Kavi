import type { NormalizedUsage, SessionUsage, TokenUsage } from '../../types/usage';
import { estimateCost } from './usagePricing';
import { STORAGE_KEYS } from '../../constants/storage';
import { throttledAsyncStorage } from '../../store/throttledStorage';
import { createLogger } from '../../utils/logger';
import {
  exportTokenCalibrationState,
  importTokenCalibrationState,
  isValidTokenCalibrationState,
  recordObservedTokenRatio,
  type TokenCalibrationState,
} from '../context/tokenCalibration';

// ---------------------------------------------------------------------------
// Usage Tracker
// ---------------------------------------------------------------------------
// Tracks cumulative session usage, cache summary reporting, and public tracker
// compatibility exports. Also owns durable persistence of the token-estimator
// calibration state learned in `../context/tokenCalibration.ts` (see the
// "Token calibration persistence" section below), since this module already
// owns the app's other durable usage accounting.

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

// ── Token calibration persistence ────────────────────────────────────────
// `../context/tokenCalibration.ts` learns a per-provider-family token
// estimator correction factor online, purely in memory — it resets to the
// uncorrected default on every process restart. That module exposes
// `exportTokenCalibrationState`/`importTokenCalibrationState` as its
// persistence seam rather than a private map; the functions below are the
// other half of that seam: they read and write the app's existing
// debounced, file-backed `throttledAsyncStorage` (the same mechanism
// `src/services/agents/subAgentRegistryPersistence.ts` and
// `src/store/chatStorePersistence.ts` use), so calibration state survives a
// restart the same way the rest of Kavi's durable state does — no new
// storage dependency.
//
// Write path: `recordAndPersistTokenCalibrationObservation` — the drop-in
// replacement for calling `recordObservedTokenRatio` directly, used by
// `recordModelTurnTokenCalibration` in
// `src/engine/graph/modelTurnExecutionSupport.ts` — records the observation
// then schedules a write. `throttledAsyncStorage.setItem` itself coalesces
// bursts of writes into one file write roughly every
// `WRITE_THROTTLE_MS` (`src/store/throttledStorage.ts`), so calling it once
// per completed model turn never costs a synchronous disk write per turn.
//
// Read path: `hydrateTokenCalibrationFromStorage` — called once from
// `src/services/startup.ts#initializeServices` on app launch, before any
// conversation can reach a model turn. It's still async relative to that
// call site (a `void ...().catch(...)` fire-and-forget, matching every
// other best-effort startup read there), so a turn that completes before it
// resolves records its observation against the in-memory default (factor 1,
// sample count 0) for that family. That's safe: `importTokenCalibrationState`
// merges by keeping whichever side — the persisted snapshot or whatever was
// already recorded live — has the higher `sampleCount` per family, so a
// late hydration can only add families it hasn't seen yet or fill in a
// family with strictly less live history than what was persisted; it can
// never overwrite a fresher live observation with a stale persisted one.
const logger = createLogger('usage.tokenCalibration');

/** Bumped whenever the persisted shape below changes; a stored payload from a
 * different version is discarded outright rather than migrated, since the
 * calibration map is a self-healing cache, not a source of truth. */
const TOKEN_CALIBRATION_SCHEMA_VERSION = 1;

interface PersistedTokenCalibrationSnapshot {
  version: number;
  families: Record<string, TokenCalibrationState>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a raw, parsed-JSON `families` map at the trust boundary: only
 * entries that pass {@link isValidTokenCalibrationState} survive. Anything
 * else — a non-object payload, an out-of-range or non-finite factor, a
 * fractional or negative sample count — is dropped rather than applied, so a
 * corrupted or hand-edited storage file can't push a bad calibration factor
 * back into the live estimator.
 */
function sanitizePersistedTokenCalibrationFamilies(
  value: unknown,
): Record<string, TokenCalibrationState> {
  if (!isPlainObject(value)) return {};

  const sanitized: Record<string, TokenCalibrationState> = {};
  for (const [family, candidate] of Object.entries(value)) {
    if (isValidTokenCalibrationState(candidate)) {
      sanitized[family] = candidate;
    }
  }
  return sanitized;
}

/**
 * Hydrate the in-memory calibration map from durable storage. Safe to call
 * even when nothing has ever been persisted (first launch) or when the
 * stored payload is missing, unparsable, shaped wrong, or from a different
 * schema version — every one of those is logged and treated as "nothing to
 * hydrate" rather than thrown.
 */
export async function hydrateTokenCalibrationFromStorage(): Promise<void> {
  let raw: string | null;
  try {
    raw = await throttledAsyncStorage.getItem(STORAGE_KEYS.TOKEN_CALIBRATION);
  } catch (error) {
    logger.warn('Failed to read persisted token calibration state', error);
    return;
  }
  if (!raw) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.warn('Discarding unparsable persisted token calibration state', error);
    return;
  }

  if (!isPlainObject(parsed) || parsed.version !== TOKEN_CALIBRATION_SCHEMA_VERSION) {
    logger.warn('Discarding persisted token calibration state with an unknown shape or version', {
      version: isPlainObject(parsed) ? parsed.version : typeof parsed,
    });
    return;
  }

  importTokenCalibrationState(sanitizePersistedTokenCalibrationFamilies(parsed.families));
}

async function persistTokenCalibrationSnapshot(): Promise<void> {
  const snapshot: PersistedTokenCalibrationSnapshot = {
    version: TOKEN_CALIBRATION_SCHEMA_VERSION,
    families: exportTokenCalibrationState() as Record<string, TokenCalibrationState>,
  };

  try {
    await throttledAsyncStorage.setItem(STORAGE_KEYS.TOKEN_CALIBRATION, JSON.stringify(snapshot));
  } catch (error) {
    logger.warn('Failed to persist token calibration state', error);
  }
}

/**
 * Record one token-calibration observation and durably persist the updated
 * calibration map. Use this instead of calling `recordObservedTokenRatio`
 * (from `../context/tokenCalibration.ts`) directly whenever an observation
 * should survive an app restart — currently every production call site, via
 * `recordModelTurnTokenCalibration` in
 * `src/engine/graph/modelTurnExecutionSupport.ts`.
 *
 * The write itself is fire-and-forget and debounced (see the module doc
 * comment above): this function never blocks or throws on a storage
 * failure, it only logs one.
 */
export function recordAndPersistTokenCalibrationObservation(
  family: string | undefined | null,
  estimatedTokens: number,
  actualTokens: number,
  appliedFactor: number,
): void {
  recordObservedTokenRatio(family, estimatedTokens, actualTokens, appliedFactor);
  void persistTokenCalibrationSnapshot();
}
