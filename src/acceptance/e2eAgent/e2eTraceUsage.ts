import type { LlmProviderFamily } from '../../types/provider';
import type {
  UsagePromptCacheEvent,
  UsagePromptCacheMode,
  UsagePromptCachePrefixDivergenceReason,
  UsageTokenBuckets,
} from '../../types/usage';
import type { E2EPromptCacheSummary, E2ETokenUsageSummary } from './types';
import { hashString, type E2ERedactedHash } from './e2eTraceRedaction';
import {
  requireNonNegativeFiniteNumber,
  requireNonNegativeSafeInteger,
} from './e2eTraceValidation';

const SAFE_PROMPT_CACHE_REASONS = [
  'automatic_prompt_cache',
  'below_threshold',
  'cache_control_breakpoints',
  'gemini_implicit_cache',
  'gemini_memory_cache_entry',
  'implicit_cache',
  'managed_or_implicit_cache',
  'no_cacheable_system_prompt',
  'sticky_provider_cache',
  'unknown',
  'unsupported_provider',
] as const;

type E2ESafePromptCacheReason = (typeof SAFE_PROMPT_CACHE_REASONS)[number];

export type E2ERedactedPromptCacheReasonCount = {
  reason?: E2ESafePromptCacheReason;
  reasonHash: E2ERedactedHash;
  count: number;
};

export type E2ERedactedPromptCacheEvent = {
  eligible: boolean;
  enabled: boolean;
  estimatedInputTokens: number;
  thresholdTokens: number;
  providerFamily?: LlmProviderFamily;
  providerFamilyHash: E2ERedactedHash;
  hostedFamily?: LlmProviderFamily;
  hostedFamilyHash?: E2ERedactedHash;
  mode: UsagePromptCacheMode;
  modeHash: E2ERedactedHash;
  event: UsagePromptCacheEvent;
  eventHash: E2ERedactedHash;
  reason?: E2ESafePromptCacheReason;
  reasonHash: E2ERedactedHash;
  explicitCacheNameHash?: E2ERedactedHash;
  stableSystemPromptDigestHash?: E2ERedactedHash;
  stableToolDeclarationDigestHash?: E2ERedactedHash;
  cacheablePrefixDigestHash?: E2ERedactedHash;
  toolDeclarationDigestHash?: E2ERedactedHash;
  prefixDivergenceReason?: UsagePromptCachePrefixDivergenceReason;
  prefixDivergenceReasonHash?: E2ERedactedHash;
};

export type E2ERedactedPromptCacheTrace = {
  eligibleTurnCount: number;
  enabledTurnCount: number;
  skippedTurnCount: number;
  createEventCount: number;
  reuseEventCount: number;
  providerManagedEventCount: number;
  thresholdTokens: number[];
  explicitCacheNameHashes: E2ERedactedHash[];
  reasonCounts: E2ERedactedPromptCacheReasonCount[];
  prefixStability?: NonNullable<E2EPromptCacheSummary['prefixStability']>;
  events: E2ERedactedPromptCacheEvent[];
};

export type E2ERedactedUsageTrace = Omit<E2ETokenUsageSummary, 'promptCache'> & {
  tokenBuckets?: UsageTokenBuckets;
  promptCache?: E2ERedactedPromptCacheTrace;
};

const SAFE_PROVIDER_FAMILY_SET = new Set<string>([
  'openai',
  'openrouter',
  'deepseek',
  'qwen',
  'kimi',
  'mistral',
  'voyage',
  'anthropic',
  'gemini',
  'ollama',
  'custom',
]);
const SAFE_PROMPT_CACHE_REASON_SET = new Set<string>(SAFE_PROMPT_CACHE_REASONS);
const SAFE_PROMPT_CACHE_MODE_SET = new Set<string>([
  'openai_native',
  'anthropic_native',
  'gemini_native',
  'openrouter_compatible',
  'unsupported',
]);
const SAFE_PROMPT_CACHE_EVENT_SET = new Set<string>([
  'create',
  'reuse',
  'skip',
  'provider_managed',
]);
const SAFE_PREFIX_DIVERGENCE_REASON_SET = new Set<string>([
  'no_tools',
  'no_stable_tool_prefix',
  'stable_prefix_with_dynamic_suffix',
  'fully_stable_prefix',
]);

function safeProviderFamily(value: string): LlmProviderFamily | undefined {
  return SAFE_PROVIDER_FAMILY_SET.has(value) ? (value as LlmProviderFamily) : undefined;
}

function safePromptCacheReason(value: string): E2ESafePromptCacheReason | undefined {
  return SAFE_PROMPT_CACHE_REASON_SET.has(value) ? (value as E2ESafePromptCacheReason) : undefined;
}

function requireEnum<T extends string>(
  value: string,
  values: ReadonlySet<string>,
  label: string,
): T {
  if (!values.has(value)) throw new Error(`${label} contains an unsupported enum value.`);
  return value as T;
}

function validatePrefixStability(
  value: NonNullable<E2EPromptCacheSummary['prefixStability']>,
): NonNullable<E2EPromptCacheSummary['prefixStability']> {
  const result = { ...value };
  for (const key of [
    'eventCount',
    'stableSystemPromptDigestEventCount',
    'stableToolDeclarationDigestEventCount',
    'cacheablePrefixDigestEventCount',
    'toolDeclarationDigestEventCount',
    'uniqueStableSystemPromptDigestCount',
    'uniqueStableToolDeclarationDigestCount',
    'uniqueCacheablePrefixDigestCount',
    'uniqueToolDeclarationDigestCount',
    'longestStableSystemPromptRun',
    'longestStableToolDeclarationRun',
    'longestCacheablePrefixRun',
    'longestToolDeclarationRun',
  ] as const) {
    result[key] = requireNonNegativeSafeInteger(value[key], `promptCache.prefixStability.${key}`);
  }
  for (const key of [
    'stableSystemPromptDigestPerEvent',
    'stableToolDeclarationDigestPerEvent',
    'cacheablePrefixDigestPerEvent',
    'toolDeclarationDigestPerEvent',
  ] as const) {
    result[key] = requireNonNegativeFiniteNumber(value[key], `promptCache.prefixStability.${key}`);
  }
  return result;
}

function buildPromptCacheTrace(
  promptCache: E2EPromptCacheSummary | undefined,
): E2ERedactedPromptCacheTrace | undefined {
  if (!promptCache) {
    return undefined;
  }
  return {
    eligibleTurnCount: requireNonNegativeSafeInteger(
      promptCache.eligibleTurnCount,
      'promptCache.eligibleTurnCount',
    ),
    enabledTurnCount: requireNonNegativeSafeInteger(
      promptCache.enabledTurnCount,
      'promptCache.enabledTurnCount',
    ),
    skippedTurnCount: requireNonNegativeSafeInteger(
      promptCache.skippedTurnCount,
      'promptCache.skippedTurnCount',
    ),
    createEventCount: requireNonNegativeSafeInteger(
      promptCache.createEventCount,
      'promptCache.createEventCount',
    ),
    reuseEventCount: requireNonNegativeSafeInteger(
      promptCache.reuseEventCount,
      'promptCache.reuseEventCount',
    ),
    providerManagedEventCount: requireNonNegativeSafeInteger(
      promptCache.providerManagedEventCount,
      'promptCache.providerManagedEventCount',
    ),
    thresholdTokens: promptCache.thresholdTokens.map((value) =>
      requireNonNegativeSafeInteger(value, 'promptCache.thresholdTokens'),
    ),
    explicitCacheNameHashes: promptCache.explicitCacheNames.map(hashString),
    reasonCounts: promptCache.reasonCounts.map(({ reason, count }) => ({
      ...(safePromptCacheReason(reason) ? { reason: safePromptCacheReason(reason) } : {}),
      reasonHash: hashString(reason),
      count: requireNonNegativeSafeInteger(count, 'promptCache.reasonCount'),
    })),
    ...(promptCache.prefixStability
      ? { prefixStability: validatePrefixStability(promptCache.prefixStability) }
      : {}),
    events: promptCache.events.map((event) => {
      const providerFamily = safeProviderFamily(event.providerFamily);
      const hostedFamily = event.hostedFamily ? safeProviderFamily(event.hostedFamily) : undefined;
      const reason = safePromptCacheReason(event.reason);
      const mode = requireEnum<UsagePromptCacheMode>(
        event.mode,
        SAFE_PROMPT_CACHE_MODE_SET,
        'promptCache.event.mode',
      );
      const cacheEvent = requireEnum<UsagePromptCacheEvent>(
        event.event,
        SAFE_PROMPT_CACHE_EVENT_SET,
        'promptCache.event.event',
      );
      const rawPrefixDivergenceReason = event.prefixDivergenceReason;
      const prefixDivergenceReason = rawPrefixDivergenceReason
        ? requireEnum<UsagePromptCachePrefixDivergenceReason>(
            rawPrefixDivergenceReason,
            SAFE_PREFIX_DIVERGENCE_REASON_SET,
            'promptCache.event.prefixDivergenceReason',
          )
        : undefined;
      const prefixDivergenceReasonHash = rawPrefixDivergenceReason
        ? hashString(rawPrefixDivergenceReason)
        : undefined;
      return {
        eligible: event.eligible,
        enabled: event.enabled,
        estimatedInputTokens: requireNonNegativeSafeInteger(
          event.estimatedInputTokens,
          'promptCache.event.estimatedInputTokens',
        ),
        thresholdTokens: requireNonNegativeSafeInteger(
          event.thresholdTokens,
          'promptCache.event.thresholdTokens',
        ),
        ...(providerFamily ? { providerFamily } : {}),
        providerFamilyHash: hashString(event.providerFamily),
        ...(hostedFamily ? { hostedFamily } : {}),
        ...(event.hostedFamily ? { hostedFamilyHash: hashString(event.hostedFamily) } : {}),
        mode,
        modeHash: hashString(event.mode),
        event: cacheEvent,
        eventHash: hashString(event.event),
        ...(reason ? { reason } : {}),
        reasonHash: hashString(event.reason),
        ...(event.explicitCacheName
          ? { explicitCacheNameHash: hashString(event.explicitCacheName) }
          : {}),
        ...(event.stableSystemPromptDigest
          ? { stableSystemPromptDigestHash: hashString(event.stableSystemPromptDigest) }
          : {}),
        ...(event.stableToolDeclarationDigest
          ? { stableToolDeclarationDigestHash: hashString(event.stableToolDeclarationDigest) }
          : {}),
        ...(event.cacheablePrefixDigest
          ? { cacheablePrefixDigestHash: hashString(event.cacheablePrefixDigest) }
          : {}),
        ...(event.toolDeclarationDigest
          ? { toolDeclarationDigestHash: hashString(event.toolDeclarationDigest) }
          : {}),
        ...(prefixDivergenceReason && prefixDivergenceReasonHash
          ? {
              prefixDivergenceReason,
              prefixDivergenceReasonHash,
            }
          : {}),
      };
    }),
  };
}

export function buildUsageTrace(usage: E2ETokenUsageSummary): E2ERedactedUsageTrace {
  const counter = (value: number, label: string) => requireNonNegativeSafeInteger(value, label);
  const tokenBuckets = usage.tokenBuckets
    ? ({
        systemPromptTokens: counter(
          usage.tokenBuckets.systemPromptTokens,
          'usage.tokenBuckets.systemPromptTokens',
        ),
        toolDeclarationTokens: counter(
          usage.tokenBuckets.toolDeclarationTokens,
          'usage.tokenBuckets.toolDeclarationTokens',
        ),
        memoryContextTokens: counter(
          usage.tokenBuckets.memoryContextTokens,
          'usage.tokenBuckets.memoryContextTokens',
        ),
        conversationHistoryTokens: counter(
          usage.tokenBuckets.conversationHistoryTokens,
          'usage.tokenBuckets.conversationHistoryTokens',
        ),
        userTurnTokens: counter(
          usage.tokenBuckets.userTurnTokens,
          'usage.tokenBuckets.userTurnTokens',
        ),
        toolResultTokens: counter(
          usage.tokenBuckets.toolResultTokens,
          'usage.tokenBuckets.toolResultTokens',
        ),
      } satisfies UsageTokenBuckets)
    : undefined;
  return {
    inputTokens: counter(usage.inputTokens, 'usage.inputTokens'),
    outputTokens: counter(usage.outputTokens, 'usage.outputTokens'),
    cacheReadTokens: counter(usage.cacheReadTokens, 'usage.cacheReadTokens'),
    cacheWriteTokens: counter(usage.cacheWriteTokens, 'usage.cacheWriteTokens'),
    totalTokens: counter(usage.totalTokens, 'usage.totalTokens'),
    eventCount: counter(usage.eventCount, 'usage.eventCount'),
    ...(tokenBuckets ? { tokenBuckets } : {}),
    ...(usage.promptCache ? { promptCache: buildPromptCacheTrace(usage.promptCache) } : {}),
  };
}
