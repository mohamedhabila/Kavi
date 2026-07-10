const {
  MAX_TRACE_ITEMS,
  asRecord,
  finiteNumber,
  nonNegativeInteger,
  projectArray,
  projectHash,
  projectHashArray,
  safeEnum,
} = require('./publicTracePrimitives');

const SAFE_PROVIDER_FAMILIES = new Set([
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
const SAFE_CACHE_MODES = new Set([
  'openai_native',
  'anthropic_native',
  'gemini_native',
  'openrouter_compatible',
  'unsupported',
  'OTHER',
]);
const SAFE_CACHE_EVENTS = new Set(['create', 'reuse', 'skip', 'provider_managed', 'OTHER']);
const SAFE_CACHE_REASONS = new Set([
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
]);
const SAFE_PREFIX_DIVERGENCE_REASONS = new Set([
  'no_tools',
  'no_stable_tool_prefix',
  'stable_prefix_with_dynamic_suffix',
  'fully_stable_prefix',
  'OTHER',
]);

const SAFE_NATIVE_FIXTURE_PATHS = new Set([
  'calendar.listed',
  'calendar.allowsModifications',
  'calendar.createdEventCount',
  'calendar.updatedEventCount',
  'permissions.location',
  'permissions.mediaLibrary',
  'permissions.screenCapture',
  'maps.opened',
  'maps.targetKind',
  'contacts.resultCount',
  'contacts.lastQuery',
  'sms.opened',
  'sms.recipientCount',
  'sms.messageLength',
  'clipboard.text',
  'clipboard.readCount',
  'clipboard.writeCount',
  'share.opened',
  'share.kind',
  'share.textLength',
  'notification.displayed',
  'notification.scheduled',
  'notification.cancelled',
  'notification.delaySeconds',
  'media.photoCount',
  'media.screenStatus',
  'media.screenBase64Length',
  'media.cameraStatus',
  'media.cameraDuration',
]);

function projectTokenBuckets(value) {
  const source = asRecord(value);
  if (!source) {
    return null;
  }
  const keys = [
    'systemPromptTokens',
    'toolDeclarationTokens',
    'memoryContextTokens',
    'conversationHistoryTokens',
    'userTurnTokens',
    'toolResultTokens',
  ];
  const projected = {};
  for (const key of keys) {
    const number = finiteNumber(source[key]);
    if (number === null) {
      return null;
    }
    projected[key] = number;
  }
  return projected;
}

function projectPrefixStability(value) {
  const source = asRecord(value);
  if (!source) {
    return null;
  }
  const keys = [
    'eventCount',
    'stableSystemPromptDigestEventCount',
    'stableToolDeclarationDigestEventCount',
    'cacheablePrefixDigestEventCount',
    'toolDeclarationDigestEventCount',
    'uniqueStableSystemPromptDigestCount',
    'uniqueStableToolDeclarationDigestCount',
    'uniqueCacheablePrefixDigestCount',
    'uniqueToolDeclarationDigestCount',
    'stableSystemPromptDigestPerEvent',
    'stableToolDeclarationDigestPerEvent',
    'cacheablePrefixDigestPerEvent',
    'toolDeclarationDigestPerEvent',
    'longestStableSystemPromptRun',
    'longestStableToolDeclarationRun',
    'longestCacheablePrefixRun',
    'longestToolDeclarationRun',
  ];
  const projected = {};
  for (const key of keys) {
    const number = finiteNumber(source[key]);
    if (number === null) {
      return null;
    }
    projected[key] = number;
  }
  return projected;
}

function projectPromptCacheReasonCount(value) {
  const source = asRecord(value);
  const reasonHash = source ? projectHash(source.reasonHash) : null;
  const count = source ? nonNegativeInteger(source.count) : null;
  if (!source || !reasonHash || count === null) {
    return null;
  }
  const reason = safeEnum(source.reason, SAFE_CACHE_REASONS);
  return {
    ...(reason ? { reason } : {}),
    reasonHash,
    count,
  };
}

function projectPromptCacheEvent(value) {
  const source = asRecord(value);
  if (!source || typeof source.eligible !== 'boolean' || typeof source.enabled !== 'boolean') {
    return null;
  }
  const estimatedInputTokens = finiteNumber(source.estimatedInputTokens);
  const thresholdTokens = finiteNumber(source.thresholdTokens);
  const providerFamilyHash = projectHash(source.providerFamilyHash);
  const modeHash = projectHash(source.modeHash);
  const eventHash = projectHash(source.eventHash);
  const reasonHash = projectHash(source.reasonHash);
  const mode = safeEnum(source.mode, SAFE_CACHE_MODES);
  const event = safeEnum(source.event, SAFE_CACHE_EVENTS);
  if (
    estimatedInputTokens === null ||
    thresholdTokens === null ||
    !providerFamilyHash ||
    !modeHash ||
    !eventHash ||
    !reasonHash ||
    !mode ||
    !event
  ) {
    return null;
  }
  const providerFamily = safeEnum(source.providerFamily, SAFE_PROVIDER_FAMILIES);
  const hostedFamily = safeEnum(source.hostedFamily, SAFE_PROVIDER_FAMILIES);
  const reason = safeEnum(source.reason, SAFE_CACHE_REASONS);
  const prefixDivergenceReason = safeEnum(
    source.prefixDivergenceReason,
    SAFE_PREFIX_DIVERGENCE_REASONS,
  );
  const optionalHashKeys = [
    'hostedFamilyHash',
    'explicitCacheNameHash',
    'stableSystemPromptDigestHash',
    'stableToolDeclarationDigestHash',
    'cacheablePrefixDigestHash',
    'toolDeclarationDigestHash',
    'prefixDivergenceReasonHash',
  ];
  const optionalHashes = {};
  for (const key of optionalHashKeys) {
    if (source[key] === undefined) {
      continue;
    }
    const hash = projectHash(source[key]);
    if (!hash) {
      return null;
    }
    optionalHashes[key] = hash;
  }
  return {
    eligible: source.eligible,
    enabled: source.enabled,
    estimatedInputTokens,
    thresholdTokens,
    ...(providerFamily ? { providerFamily } : {}),
    providerFamilyHash,
    ...(hostedFamily ? { hostedFamily } : {}),
    ...optionalHashes,
    mode,
    modeHash,
    event,
    eventHash,
    ...(reason ? { reason } : {}),
    reasonHash,
    ...(prefixDivergenceReason ? { prefixDivergenceReason } : {}),
  };
}

function projectPromptCacheTrace(value) {
  const source = asRecord(value);
  if (!source) {
    return null;
  }
  const countKeys = [
    'eligibleTurnCount',
    'enabledTurnCount',
    'skippedTurnCount',
    'createEventCount',
    'reuseEventCount',
    'providerManagedEventCount',
  ];
  const projected = {};
  for (const key of countKeys) {
    const count = nonNegativeInteger(source[key]);
    if (count === null) {
      return null;
    }
    projected[key] = count;
  }
  const thresholdTokens = projectArray(source.thresholdTokens, finiteNumber, 64);
  const explicitCacheNameHashes = projectHashArray(source.explicitCacheNameHashes, 128);
  const reasonCounts = projectArray(source.reasonCounts, projectPromptCacheReasonCount, 128);
  const events = projectArray(source.events, projectPromptCacheEvent, MAX_TRACE_ITEMS);
  if (!thresholdTokens || !explicitCacheNameHashes || !reasonCounts || !events) {
    return null;
  }
  if (source.prefixStability !== undefined) {
    const prefixStability = projectPrefixStability(source.prefixStability);
    if (!prefixStability) {
      return null;
    }
    projected.prefixStability = prefixStability;
  }
  return {
    ...projected,
    thresholdTokens,
    explicitCacheNameHashes,
    reasonCounts,
    events,
  };
}

function projectPublicUsageTrace(value) {
  const source = asRecord(value);
  if (!source) {
    return null;
  }
  const keys = [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'totalTokens',
    'eventCount',
  ];
  const projected = {};
  for (const key of keys) {
    const number = finiteNumber(source[key]);
    if (number === null) {
      return null;
    }
    projected[key] = number;
  }
  if (source.tokenBuckets !== undefined) {
    const tokenBuckets = projectTokenBuckets(source.tokenBuckets);
    if (!tokenBuckets) {
      return null;
    }
    projected.tokenBuckets = tokenBuckets;
  }
  if (source.promptCache !== undefined) {
    const promptCache = projectPromptCacheTrace(source.promptCache);
    if (!promptCache) {
      return null;
    }
    projected.promptCache = promptCache;
  }
  return projected;
}

module.exports = {
  SAFE_NATIVE_FIXTURE_PATHS,
  projectPublicUsageTrace,
};
