import type { ConversationUsageEntry, ConversationUsageSummary } from '../types/usage';
import { MAX_PERSISTED_USAGE_ENTRIES } from './chatPersistenceLimits';

const USAGE_TOKEN_BUCKET_KEYS = [
  'systemPromptTokens',
  'toolDeclarationTokens',
  'memoryContextTokens',
  'conversationHistoryTokens',
  'userTurnTokens',
  'toolResultTokens',
] as const;

const PROMPT_CACHE_EVENTS = new Set(['create', 'reuse', 'skip', 'provider_managed']);
const PROMPT_CACHE_MODES = new Set([
  'openai_native',
  'anthropic_native',
  'gemini_native',
  'openrouter_compatible',
  'unsupported',
]);
const PROMPT_CACHE_PREFIX_DIVERGENCE_REASONS = new Set([
  'no_tools',
  'no_stable_tool_prefix',
  'stable_prefix_with_dynamic_suffix',
  'fully_stable_prefix',
]);

function sanitizeTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : undefined;
}

function sanitizeUsageTokenBuckets(
  tokenBuckets: ConversationUsageEntry['tokenBuckets'],
): ConversationUsageEntry['tokenBuckets'] | undefined {
  if (!tokenBuckets || typeof tokenBuckets !== 'object') {
    return undefined;
  }

  const sanitized: Record<(typeof USAGE_TOKEN_BUCKET_KEYS)[number], number> = {
    systemPromptTokens: 0,
    toolDeclarationTokens: 0,
    memoryContextTokens: 0,
    conversationHistoryTokens: 0,
    userTurnTokens: 0,
    toolResultTokens: 0,
  };
  for (const key of USAGE_TOKEN_BUCKET_KEYS) {
    const value = sanitizeTokenCount(tokenBuckets[key]);
    if (value === undefined) {
      return undefined;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function sanitizeOptionalUsageString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sanitizeUsagePromptCacheTelemetry(
  promptCache: ConversationUsageEntry['promptCache'],
): ConversationUsageEntry['promptCache'] | undefined {
  if (!promptCache || typeof promptCache !== 'object') {
    return undefined;
  }

  const record = promptCache as unknown as Record<string, unknown>;
  const estimatedInputTokens = sanitizeTokenCount(record.estimatedInputTokens);
  const thresholdTokens = sanitizeTokenCount(record.thresholdTokens);
  const providerFamily = sanitizeOptionalUsageString(record.providerFamily);
  const mode = sanitizeOptionalUsageString(record.mode);
  const event = sanitizeOptionalUsageString(record.event);
  const reason = sanitizeOptionalUsageString(record.reason);
  if (
    estimatedInputTokens === undefined ||
    thresholdTokens === undefined ||
    !providerFamily ||
    !mode ||
    !PROMPT_CACHE_MODES.has(mode) ||
    !event ||
    !PROMPT_CACHE_EVENTS.has(event) ||
    !reason
  ) {
    return undefined;
  }

  const hostedFamily = sanitizeOptionalUsageString(record.hostedFamily);
  const explicitCacheName = sanitizeOptionalUsageString(record.explicitCacheName);
  const stableSystemPromptDigest = sanitizeOptionalUsageString(record.stableSystemPromptDigest);
  const stableToolDeclarationDigest = sanitizeOptionalUsageString(
    record.stableToolDeclarationDigest,
  );
  const cacheablePrefixDigest = sanitizeOptionalUsageString(record.cacheablePrefixDigest);
  const toolDeclarationDigest = sanitizeOptionalUsageString(record.toolDeclarationDigest);
  const rawPrefixDivergenceReason = sanitizeOptionalUsageString(record.prefixDivergenceReason);
  const prefixDivergenceReason =
    rawPrefixDivergenceReason &&
    PROMPT_CACHE_PREFIX_DIVERGENCE_REASONS.has(rawPrefixDivergenceReason)
      ? rawPrefixDivergenceReason
      : undefined;
  return {
    eligible: record.eligible === true,
    enabled: record.enabled === true,
    estimatedInputTokens,
    thresholdTokens,
    providerFamily,
    ...(hostedFamily ? { hostedFamily } : {}),
    mode: mode as NonNullable<ConversationUsageEntry['promptCache']>['mode'],
    event: event as NonNullable<ConversationUsageEntry['promptCache']>['event'],
    reason,
    ...(explicitCacheName ? { explicitCacheName } : {}),
    ...(stableSystemPromptDigest ? { stableSystemPromptDigest } : {}),
    ...(stableToolDeclarationDigest ? { stableToolDeclarationDigest } : {}),
    ...(cacheablePrefixDigest ? { cacheablePrefixDigest } : {}),
    ...(toolDeclarationDigest ? { toolDeclarationDigest } : {}),
    ...(prefixDivergenceReason
      ? {
          prefixDivergenceReason: prefixDivergenceReason as NonNullable<
            ConversationUsageEntry['promptCache']
          >['prefixDivergenceReason'],
        }
      : {}),
  };
}

function sanitizeUsageEntry(entry: ConversationUsageEntry): ConversationUsageEntry {
  const tokenDetails = entry.tokenDetails
    ? {
        ...(typeof entry.tokenDetails.inputTextTokens === 'number' &&
        Number.isFinite(entry.tokenDetails.inputTextTokens)
          ? { inputTextTokens: Math.max(0, entry.tokenDetails.inputTextTokens) }
          : {}),
        ...(typeof entry.tokenDetails.inputImageTokens === 'number' &&
        Number.isFinite(entry.tokenDetails.inputImageTokens)
          ? { inputImageTokens: Math.max(0, entry.tokenDetails.inputImageTokens) }
          : {}),
        ...(typeof entry.tokenDetails.outputTextTokens === 'number' &&
        Number.isFinite(entry.tokenDetails.outputTextTokens)
          ? { outputTextTokens: Math.max(0, entry.tokenDetails.outputTextTokens) }
          : {}),
        ...(typeof entry.tokenDetails.outputImageTokens === 'number' &&
        Number.isFinite(entry.tokenDetails.outputImageTokens)
          ? { outputImageTokens: Math.max(0, entry.tokenDetails.outputImageTokens) }
          : {}),
        ...(typeof entry.tokenDetails.outputThinkingTokens === 'number' &&
        Number.isFinite(entry.tokenDetails.outputThinkingTokens)
          ? { outputThinkingTokens: Math.max(0, entry.tokenDetails.outputThinkingTokens) }
          : {}),
      }
    : undefined;
  const tokenBuckets = sanitizeUsageTokenBuckets(entry.tokenBuckets);
  const promptCache = sanitizeUsagePromptCacheTelemetry(entry.promptCache);

  return {
    model: entry.model,
    ...(entry.providerId ? { providerId: entry.providerId } : {}),
    ...(entry.source ? { source: entry.source } : {}),
    ...(entry.modality ? { modality: entry.modality } : {}),
    ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {}),
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    ...(entry.parentSessionId ? { parentSessionId: entry.parentSessionId } : {}),
    ...(entry.agentRunId ? { agentRunId: entry.agentRunId } : {}),
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheReadTokens: entry.cacheReadTokens,
    cacheWriteTokens: entry.cacheWriteTokens,
    totalTokens: entry.totalTokens,
    estimatedCost: entry.estimatedCost,
    ...(tokenDetails && Object.keys(tokenDetails).length > 0 ? { tokenDetails } : {}),
    ...(tokenBuckets ? { tokenBuckets } : {}),
    ...(promptCache ? { promptCache } : {}),
    timestamp: entry.timestamp,
  };
}

export function sanitizeUsage(
  usage: ConversationUsageSummary | undefined,
): ConversationUsageSummary | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    ...usage,
    entries: usage.entries
      .slice(-MAX_PERSISTED_USAGE_ENTRIES)
      .map((entry) => sanitizeUsageEntry(entry)),
  };
}
