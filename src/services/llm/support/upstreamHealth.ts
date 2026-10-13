import type { ToolCall } from '../../../types/message';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('UpstreamToolCallHealth');

/**
 * Tool-call health of the upstreams an aggregator routes a model to.
 *
 * A routed provider (OpenRouter) serves one model from many upstreams, and an upstream's
 * tool-call parser can be broken while every other one is fine. Measured for GLM 5.3 Flash
 * on OpenRouter: one upstream delivered `update_goals` with its arguments stripped in 5 of
 * 8 forced calls and looped every run it served, while six others never did. People bring
 * their own keys, so nothing can be configured per account: the app watches the tool calls
 * each upstream produces and, after repeated argument faults, asks the aggregator not to
 * route this model there for a while. It is a circuit breaker on a failing dependency,
 * keyed by what was observed, never a list of names.
 */

/** Consecutive argument faults from one upstream, with no good call between, that trip it. */
const TRIP_AFTER_CONSECUTIVE_FAULTS = 2;
/** How long a tripped upstream is left out before it is tried again. */
const EXCLUSION_TTL_MS = 2 * 60 * 60 * 1000;
/** Never leave out more than this many upstreams for one model. */
const MAX_EXCLUDED_UPSTREAMS_PER_MODEL = 3;
/** Bound on tool calls awaiting their outcome, so unsettled ones cannot accumulate. */
const MAX_PENDING_ATTRIBUTIONS = 512;

type UpstreamHealth = { consecutiveFaults: number; excludedUntil?: number };

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
    health = { consecutiveFaults: 0 };
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

  const alreadyExcluded = health.excludedUntil !== undefined && health.excludedUntil > now;
  if (
    health.consecutiveFaults >= TRIP_AFTER_CONSECUTIVE_FAULTS &&
    !alreadyExcluded &&
    countExcluded(attribution.model, now) < MAX_EXCLUDED_UPSTREAMS_PER_MODEL
  ) {
    health.excludedUntil = now + EXCLUSION_TTL_MS;
    health.consecutiveFaults = 0;
    logger.warn('Routing around an upstream whose tool calls arrive malformed.', {
      model: attribution.model,
      upstream: attribution.upstream,
      excludedForMs: EXCLUSION_TTL_MS,
    });
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
}
