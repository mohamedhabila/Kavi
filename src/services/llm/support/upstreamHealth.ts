import type { AssistantCompletionMetadata, ToolCall } from '../../../types/message';
import { createLogger } from '../../../utils/logger';
import { isTokenBudgetExhaustedCompletion } from './completionRecovery';

const logger = createLogger('UpstreamHealth');

/**
 * Health of the upstreams an aggregator routes a model to.
 *
 * A routed provider (OpenRouter) serves one model from many upstreams, and one upstream can
 * be broken while every other one is fine. People bring their own keys, so nothing can be
 * configured per account: the app watches what each upstream does and, after repeated
 * failures, asks the aggregator not to route this model there for a while. It is a circuit
 * breaker on a failing dependency, keyed by what was observed, never a list of names.
 *
 * Three failures trip it:
 * - Tool calls that arrive with their arguments stripped. Measured for GLM 5.3 Flash: one
 *   upstream did it in 5 of 8 forced calls and looped every run it served; six never did.
 * - A prompt cache that never hits. Every GLM 5.3 Flash upstream lists a cache-read price,
 *   yet one read 3k of 191k input tokens from cache over 38 calls that repeated the prefix
 *   of the call before them, while another read 91%. The aggregator keeps a conversation on
 *   the upstream that served it first, so a conversation that lands there pays full price
 *   for its whole context on every call.
 * - Responses that arrive empty: no visible text and no tool call, with output tokens left.
 *   Over two GLM 5.3 Flash phone-world runs one upstream did it on 22 of 89 calls and two
 *   others on 0 of 205; the aggregator sent each recovery retry back to the same upstream,
 *   so three empty turns in a row ended the run.
 */

/** Consecutive argument faults from one upstream, with no good call between, that trip it. */
const TRIP_AFTER_CONSECUTIVE_FAULTS = 2;
/** How long a tripped upstream is left out before it is tried again. */
const EXCLUSION_TTL_MS = 2 * 60 * 60 * 1000;
/** Never leave out more than this many upstreams for one model. */
const MAX_EXCLUDED_UPSTREAMS_PER_MODEL = 3;
/** Bound on tool calls awaiting their outcome, so unsettled ones cannot accumulate. */
const MAX_PENDING_ATTRIBUTIONS = 512;
/**
 * Calls that repeat a recent prefix on the same upstream and read nothing from its cache,
 * with no hit between, that trip it.
 */
const TRIP_AFTER_CONSECUTIVE_CACHE_MISSES = 3;
/**
 * How recently the same prefix must have been sent for a call to be expected to hit: inside
 * the shortest provider cache lifetime (five minutes) and the aggregator's ten-minute window.
 */
const CACHE_EXPECTED_WITHIN_MS = 5 * 60 * 1000;
/** Prefixes shorter than this may sit under a provider's caching minimum. */
const MIN_CACHEABLE_INPUT_TOKENS = 2_048;
/** Bound on remembered prefixes. */
const MAX_REMEMBERED_PREFIXES = 256;
/** Consecutive empty turns from one upstream, with no delivered turn between, that trip it. */
const TRIP_AFTER_CONSECUTIVE_EMPTY_TURNS = 2;

type UpstreamHealth = {
  consecutiveFaults: number;
  consecutiveCacheMisses: number;
  consecutiveEmptyTurns: number;
  excludedUntil?: number;
};

const healthByModel = new Map<string, Map<string, UpstreamHealth>>();
const attributionByToolCallId = new Map<string, { model: string; upstream: string }>();

function healthFor(model: string, upstream: string): UpstreamHealth {
  let byUpstream = healthByModel.get(model);
  if (!byUpstream) {
    byUpstream = new Map();
    healthByModel.set(model, byUpstream);
  }
  let health = byUpstream.get(upstream);
  if (!health) {
    health = { consecutiveFaults: 0, consecutiveCacheMisses: 0, consecutiveEmptyTurns: 0 };
    byUpstream.set(upstream, health);
  }
  return health;
}

/** Remember which upstream produced these tool calls, to credit or fault it on their outcome. */
export function noteToolCallsServedBy(params: {
  model: string;
  upstream: string | undefined;
  toolCallIds: ReadonlyArray<string>;
}): void {
  const upstream = params.upstream?.trim();
  if (!upstream || !params.model) return;
  for (const toolCallId of params.toolCallIds) {
    if (!toolCallId) continue;
    attributionByToolCallId.set(toolCallId, { model: params.model, upstream });
  }
  while (attributionByToolCallId.size > MAX_PENDING_ATTRIBUTIONS) {
    const oldest = attributionByToolCallId.keys().next().value;
    if (oldest === undefined) break;
    attributionByToolCallId.delete(oldest);
  }
}

function countExcluded(model: string, now: number): number {
  let count = 0;
  for (const health of healthByModel.get(model)?.values() ?? []) {
    if (health.excludedUntil !== undefined && health.excludedUntil > now) count += 1;
  }
  return count;
}

/** Credit or fault the upstream that produced a tool call, once its outcome is known. */
export function settleToolCallOutcome(
  toolCall: Pick<ToolCall, 'id' | 'status' | 'failureKind'>,
  now: number = Date.now(),
): void {
  const attribution = attributionByToolCallId.get(toolCall.id);
  if (!attribution || (toolCall.status !== 'completed' && toolCall.status !== 'failed')) return;
  attributionByToolCallId.delete(toolCall.id);

  const health = healthFor(attribution.model, attribution.upstream);
  if (toolCall.status === 'failed' && toolCall.failureKind === 'invalid_arguments') {
    health.consecutiveFaults += 1;
  } else if (toolCall.status === 'completed') {
    health.consecutiveFaults = 0;
  } else {
    // Any other failure says nothing about how the upstream parsed the call.
    return;
  }

  if (health.consecutiveFaults >= TRIP_AFTER_CONSECUTIVE_FAULTS) {
    trip(
      attribution.model,
      attribution.upstream,
      health,
      now,
      'Routing around an upstream whose tool calls arrive malformed.',
    );
  }
}

function trip(
  model: string,
  upstream: string,
  health: UpstreamHealth,
  now: number,
  reason: string,
) {
  const alreadyExcluded = health.excludedUntil !== undefined && health.excludedUntil > now;
  if (alreadyExcluded || countExcluded(model, now) >= MAX_EXCLUDED_UPSTREAMS_PER_MODEL) return;
  health.excludedUntil = now + EXCLUSION_TTL_MS;
  health.consecutiveFaults = 0;
  health.consecutiveCacheMisses = 0;
  health.consecutiveEmptyTurns = 0;
  logger.warn(reason, { model, upstream, excludedForMs: EXCLUSION_TTL_MS });
}

/**
 * Note what the upstream that served a model turn sent back: its tool calls, credited or
 * faulted once their outcome is known, and whether it delivered anything at all. A turn that
 * ran out of output tokens is the request's budget, not the upstream, and is not judged.
 */
export function noteModelTurnServedBy(params: {
  model: string;
  upstream: string | undefined;
  toolCallIds: ReadonlyArray<string>;
  content: string;
  completion: AssistantCompletionMetadata | undefined;
  now?: number;
}): void {
  noteToolCallsServedBy(params);
  const upstream = params.upstream?.trim();
  if (!upstream || !params.model || isTokenBudgetExhaustedCompletion(params.completion)) return;
  const health = healthFor(params.model, upstream);
  if (params.toolCallIds.length > 0 || params.content.trim().length > 0) {
    health.consecutiveEmptyTurns = 0;
    return;
  }
  health.consecutiveEmptyTurns += 1;
  if (health.consecutiveEmptyTurns >= TRIP_AFTER_CONSECUTIVE_EMPTY_TURNS) {
    trip(
      params.model,
      upstream,
      health,
      params.now ?? Date.now(),
      'Routing around an upstream whose responses arrive empty.',
    );
  }
}

/** When each prefix was last sent to each upstream, to know which calls should hit. */
const prefixLastSentAt = new Map<string, number>();

/**
 * Note how much of a call's input an upstream read from its cache. A call counts only when
 * the same upstream was sent the same cacheable prefix (system prompt and tools) moments
 * before, long enough to be cached: that call should read at least that prefix back.
 */
export function noteUpstreamCacheResult(params: {
  model: string;
  upstream: string | undefined;
  prefixDigest: string | undefined;
  inputTokens: number;
  cacheReadTokens: number;
  now?: number;
}): void {
  const upstream = params.upstream?.trim();
  if (!upstream || !params.model || !params.prefixDigest) return;
  if (!(params.inputTokens >= MIN_CACHEABLE_INPUT_TOKENS)) return;
  const now = params.now ?? Date.now();
  const key = `${params.model}\u0000${upstream}\u0000${params.prefixDigest}`;
  const lastSentAt = prefixLastSentAt.get(key);
  prefixLastSentAt.delete(key);
  prefixLastSentAt.set(key, now);
  while (prefixLastSentAt.size > MAX_REMEMBERED_PREFIXES) {
    const oldest = prefixLastSentAt.keys().next().value;
    if (oldest === undefined) break;
    prefixLastSentAt.delete(oldest);
  }
  if (lastSentAt === undefined || now - lastSentAt > CACHE_EXPECTED_WITHIN_MS) return;

  const health = healthFor(params.model, upstream);
  if (params.cacheReadTokens > 0) {
    health.consecutiveCacheMisses = 0;
    return;
  }
  health.consecutiveCacheMisses += 1;
  if (health.consecutiveCacheMisses >= TRIP_AFTER_CONSECUTIVE_CACHE_MISSES) {
    trip(
      params.model,
      upstream,
      health,
      now,
      'Routing around an upstream whose prompt cache never hits.',
    );
  }
}

/** Upstreams to leave out when routing this model, for now. */
export function getExcludedUpstreams(model: string, now: number = Date.now()): string[] {
  const byUpstream = healthByModel.get(model);
  if (!byUpstream) return [];
  const excluded: string[] = [];
  for (const [upstream, health] of byUpstream) {
    if (health.excludedUntil !== undefined && health.excludedUntil > now) excluded.push(upstream);
  }
  return excluded.sort();
}

/** Visible for testing only. */
export function _resetUpstreamToolCallHealthForTests(): void {
  healthByModel.clear();
  attributionByToolCallId.clear();
  prefixLastSentAt.clear();
}
