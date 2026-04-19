import { getLocalLlmCatalogEntry } from '../localLlm/catalog';

// ---------------------------------------------------------------------------
// Kavi — Usage Tracker
// ---------------------------------------------------------------------------
// Normalizes token usage across 20+ provider naming variants.
// Tracks cumulative session usage and provides cost estimates.

import type { NormalizedUsage, SessionUsage, TokenUsage, UsageTokenDetails } from '../../types';

// ── Cost per 1M tokens (approximate USD) ─────────────────────────────────

interface FlatCostRates {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

interface TieredCostRates {
  promptThreshold: number;
  standard: FlatCostRates;
  largePrompt: FlatCostRates;
}

type ModelCostRates = FlatCostRates | TieredCostRates;

interface ModalityCostRates {
  inputText: number;
  outputText: number;
  inputImage?: number;
  outputImage?: number;
  outputThinking?: number;
  cacheReadText?: number;
  cacheReadImage?: number;
}

type CacheUsageSummary = {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheDenominatorTokens: number;
};

const COST_TABLE: Record<string, ModelCostRates> = {
  'gpt-5.4': { input: 2.5, output: 15 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'o1': { input: 15, output: 60 },
  'o3': { input: 2, output: 8 },
  'o4-mini': { input: 1.1, output: 4.4 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'gemini-3.1-pro-preview': {
    promptThreshold: 200_000,
    standard: { input: 2, output: 12, cacheRead: 0.2 },
    largePrompt: { input: 4, output: 18, cacheRead: 0.4 },
  },
  'gemini-3-flash-preview': { input: 0.5, output: 3, cacheRead: 0.05 },
  'gemini-2.5-pro': {
    promptThreshold: 200_000,
    standard: { input: 1.25, output: 10, cacheRead: 0.125 },
    largePrompt: { input: 2.5, output: 15, cacheRead: 0.25 },
  },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cacheRead: 0.03 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4, cacheRead: 0.01 },
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  'mistral-large-3': { input: 2, output: 6 },
  'mistral-small-3.2': { input: 0.1, output: 0.3 },
};

const MODALITY_COST_TABLE: Array<{ match: string; rates: ModalityCostRates }> = [
  {
    match: 'gpt-image-1-mini',
    rates: {
      inputText: 2,
      outputText: 0,
      inputImage: 2.5,
      outputImage: 8,
      cacheReadText: 0.2,
      cacheReadImage: 0.25,
    },
  },
  {
    match: 'gpt-image-1.5',
    rates: {
      inputText: 5,
      outputText: 10,
      inputImage: 8,
      outputImage: 32,
      cacheReadText: 1.25,
      cacheReadImage: 2,
    },
  },
  {
    match: 'chatgpt-image-latest',
    rates: {
      inputText: 5,
      outputText: 10,
      inputImage: 8,
      outputImage: 32,
      cacheReadText: 1.25,
      cacheReadImage: 2,
    },
  },
  {
    match: 'gpt-image-1',
    rates: {
      inputText: 5,
      outputText: 10,
      inputImage: 8,
      outputImage: 32,
      cacheReadText: 1.25,
      cacheReadImage: 2,
    },
  },
  {
    match: 'gemini-3.1-flash-image-preview',
    rates: {
      inputText: 0.5,
      outputText: 3,
      inputImage: 0.5,
      outputImage: 60,
      outputThinking: 3,
    },
  },
  {
    match: 'gemini-3-pro-image-preview',
    rates: {
      inputText: 2,
      outputText: 12,
      inputImage: 2,
      outputImage: 120,
      outputThinking: 12,
    },
  },
  {
    match: 'gemini-2.5-flash-image',
    rates: {
      inputText: 0.3,
      outputText: 2.5,
      inputImage: 0.3,
      outputImage: 30,
      outputThinking: 2.5,
    },
  },
];

// ── Normalize raw usage from various provider formats ────────────────────

export function normalizeUsage(raw?: any): NormalizedUsage | undefined {
  if (!raw) return undefined;

  const usageMetadata = raw.usage_metadata ?? raw.usageMetadata;
  const promptTokenDetails = raw.prompt_tokens_details ?? raw.promptTokensDetails;
  const inputTokenDetails = raw.input_tokens_details ?? raw.inputTokensDetails;
  const outputTokenDetails = raw.output_tokens_details ?? raw.outputTokensDetails;
  const cacheCreation = raw.cache_creation ?? raw.cacheCreation;
  const promptDetailCounts = extractModalityTokenCounts(promptTokenDetails);
  const inputDetailCounts = extractModalityTokenCounts(inputTokenDetails);
  const candidateDetailCounts = extractModalityTokenCounts(
    raw.candidates_tokens_details ??
      raw.candidatesTokensDetails ??
      usageMetadata?.candidates_tokens_details ??
      usageMetadata?.candidatesTokensDetails,
  );
  const outputDetailCounts = extractModalityTokenCounts(outputTokenDetails);

  const promptInputTokens = pickFiniteNumber(
    raw.prompt_tokens,
    raw.promptTokens,
    raw.prompt_token_count,
    raw.promptTokenCount,
    usageMetadata?.prompt_token_count,
    usageMetadata?.promptTokenCount,
  );
  const directInputTokens = pickFiniteNumber(raw.input_tokens, raw.inputTokens);

  const outputTokens =
    pickFiniteNumber(
      raw.output_tokens,
      raw.outputTokens,
      raw.completion_tokens,
      raw.completionTokens,
      raw.output_token_count,
      raw.outputTokenCount,
    ) ??
    (pickFiniteNumber(
      raw.candidates_token_count,
      raw.candidatesTokenCount,
      usageMetadata?.candidates_token_count,
      usageMetadata?.candidatesTokenCount,
    ) ?? 0) +
      (pickFiniteNumber(
        raw.thoughts_token_count,
        raw.thoughtsTokenCount,
        usageMetadata?.thoughts_token_count,
        usageMetadata?.thoughtsTokenCount,
      ) ?? 0);

  const cacheReadTokens =
    pickFiniteNumber(
      raw.cache_read_input_tokens,
      raw.cacheReadTokens,
      raw.cached_tokens,
      raw.cachedTokens,
      raw.cached_content_token_count,
      raw.cachedContentTokenCount,
      promptTokenDetails?.cached_tokens,
      promptTokenDetails?.cachedTokens,
      inputTokenDetails?.cached_tokens,
      inputTokenDetails?.cachedTokens,
      usageMetadata?.cached_tokens,
      usageMetadata?.cachedTokens,
      usageMetadata?.cached_content_token_count,
      usageMetadata?.cachedContentTokenCount,
    ) ?? 0;

  const cacheWriteBreakdownTokens =
    (pickFiniteNumber(
      cacheCreation?.ephemeral_5m_input_tokens,
      cacheCreation?.ephemeral5mInputTokens,
    ) ?? 0) +
    (pickFiniteNumber(
      cacheCreation?.ephemeral_1h_input_tokens,
      cacheCreation?.ephemeral1hInputTokens,
    ) ?? 0);

  const cacheWriteTokens =
    pickFiniteNumber(
      raw.cache_creation_input_tokens,
      raw.cacheCreationInputTokens,
      raw.cacheWriteTokens,
      promptTokenDetails?.cache_write_tokens,
      promptTokenDetails?.cacheWriteTokens,
      inputTokenDetails?.cache_write_tokens,
      inputTokenDetails?.cacheWriteTokens,
      usageMetadata?.cache_write_tokens,
      usageMetadata?.cacheWriteTokens,
    ) ?? (cacheWriteBreakdownTokens > 0 ? cacheWriteBreakdownTokens : 0);

  const hasAnthropicStyleCacheAccounting =
    directInputTokens !== undefined &&
    (pickFiniteNumber(
      raw.cache_creation_input_tokens,
      raw.cacheCreationInputTokens,
      raw.cache_read_input_tokens,
      raw.cacheReadInputTokens,
    ) !== undefined ||
      cacheCreation !== undefined);

  const inputTokens =
    promptInputTokens ??
    (directInputTokens ?? 0) +
      (hasAnthropicStyleCacheAccounting ? cacheReadTokens + cacheWriteTokens : 0);

  const reportedTotalTokens = pickFiniteNumber(
    raw.total_tokens,
    raw.totalTokens,
    raw.total_token_count,
    raw.totalTokenCount,
    usageMetadata?.total_token_count,
    usageMetadata?.totalTokenCount,
  );
  const totalTokens = Math.max(inputTokens + outputTokens, reportedTotalTokens ?? 0);

  const inputTextTokens =
    pickFiniteNumber(
      inputTokenDetails?.text_tokens,
      inputTokenDetails?.textTokens,
      promptTokenDetails?.text_tokens,
      promptTokenDetails?.textTokens,
    ) ??
    inputDetailCounts.textTokens ??
    promptDetailCounts.textTokens;
  const inputImageTokens =
    pickFiniteNumber(
      inputTokenDetails?.image_tokens,
      inputTokenDetails?.imageTokens,
      promptTokenDetails?.image_tokens,
      promptTokenDetails?.imageTokens,
    ) ??
    inputDetailCounts.imageTokens ??
    promptDetailCounts.imageTokens;
  const outputTextTokens =
    pickFiniteNumber(outputTokenDetails?.text_tokens, outputTokenDetails?.textTokens) ??
    outputDetailCounts.textTokens ??
    candidateDetailCounts.textTokens;
  const outputImageTokens =
    pickFiniteNumber(outputTokenDetails?.image_tokens, outputTokenDetails?.imageTokens) ??
    outputDetailCounts.imageTokens ??
    candidateDetailCounts.imageTokens;
  const outputThinkingTokens = pickFiniteNumber(
    outputTokenDetails?.thinking_tokens,
    outputTokenDetails?.thinkingTokens,
    raw.thoughts_token_count,
    raw.thoughtsTokenCount,
    usageMetadata?.thoughts_token_count,
    usageMetadata?.thoughtsTokenCount,
  );
  const tokenDetails = buildUsageTokenDetails({
    inputTextTokens,
    inputImageTokens,
    outputTextTokens,
    outputImageTokens,
    outputThinkingTokens,
  });

  return {
    inputTokens: Math.max(0, inputTokens),
    outputTokens: Math.max(0, outputTokens),
    cacheReadTokens: Math.max(0, cacheReadTokens),
    cacheWriteTokens: Math.max(0, cacheWriteTokens),
    totalTokens: Math.max(0, totalTokens),
    ...(tokenDetails ? { tokenDetails } : {}),
  };
}

function extractModalityTokenCounts(details: unknown): {
  textTokens?: number;
  imageTokens?: number;
} {
  if (!details || typeof details !== 'object') {
    return {};
  }

  if (!Array.isArray(details)) {
    const textTokens = pickFiniteNumber(
      (details as Record<string, unknown>).text_tokens,
      (details as Record<string, unknown>).textTokens,
    );
    const imageTokens = pickFiniteNumber(
      (details as Record<string, unknown>).image_tokens,
      (details as Record<string, unknown>).imageTokens,
    );

    return {
      ...(textTokens !== undefined ? { textTokens } : {}),
      ...(imageTokens !== undefined ? { imageTokens } : {}),
    };
  }

  let textTokens = 0;
  let imageTokens = 0;
  let sawTextTokens = false;
  let sawImageTokens = false;

  for (const item of details) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const modality = String(
      (item as Record<string, unknown>).modality ??
        (item as Record<string, unknown>).modalityType ??
        (item as Record<string, unknown>).type ??
        '',
    )
      .trim()
      .toLowerCase();
    const tokenCount =
      pickFiniteNumber(
        (item as Record<string, unknown>).tokenCount,
        (item as Record<string, unknown>).token_count,
        (item as Record<string, unknown>).count,
        (item as Record<string, unknown>).value,
      ) ?? 0;

    if (modality.includes('image')) {
      imageTokens += tokenCount;
      sawImageTokens = true;
      continue;
    }

    if (modality.includes('text')) {
      textTokens += tokenCount;
      sawTextTokens = true;
    }
  }

  return {
    ...(sawTextTokens ? { textTokens } : {}),
    ...(sawImageTokens ? { imageTokens } : {}),
  };
}

function buildUsageTokenDetails(details: UsageTokenDetails): UsageTokenDetails | undefined {
  const normalized = {
    ...(typeof details.inputTextTokens === 'number' &&
    Number.isFinite(details.inputTextTokens) &&
    details.inputTextTokens > 0
      ? { inputTextTokens: Math.max(0, details.inputTextTokens) }
      : {}),
    ...(typeof details.inputImageTokens === 'number' &&
    Number.isFinite(details.inputImageTokens) &&
    details.inputImageTokens > 0
      ? { inputImageTokens: Math.max(0, details.inputImageTokens) }
      : {}),
    ...(typeof details.outputTextTokens === 'number' &&
    Number.isFinite(details.outputTextTokens) &&
    details.outputTextTokens > 0
      ? { outputTextTokens: Math.max(0, details.outputTextTokens) }
      : {}),
    ...(typeof details.outputImageTokens === 'number' &&
    Number.isFinite(details.outputImageTokens) &&
    details.outputImageTokens > 0
      ? { outputImageTokens: Math.max(0, details.outputImageTokens) }
      : {}),
    ...(typeof details.outputThinkingTokens === 'number' &&
    Number.isFinite(details.outputThinkingTokens) &&
    details.outputThinkingTokens > 0
      ? { outputThinkingTokens: Math.max(0, details.outputThinkingTokens) }
      : {}),
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function pickFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) {
      return numberValue;
    }
  }
  return undefined;
}

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

function isTieredCostRates(rates: ModelCostRates): rates is TieredCostRates {
  return 'promptThreshold' in rates;
}

function resolveCostRates(model: string, inputTokens: number): FlatCostRates | undefined {
  const lower = model.toLowerCase();

  for (const [key, rates] of Object.entries(COST_TABLE)) {
    if (!lower.includes(key)) {
      continue;
    }

    if (isTieredCostRates(rates)) {
      return inputTokens > rates.promptThreshold ? rates.largePrompt : rates.standard;
    }

    return rates;
  }

  return undefined;
}

function resolveModalityCostRates(model: string): ModalityCostRates | undefined {
  const lower = model.toLowerCase();
  return MODALITY_COST_TABLE.find((entry) => lower.includes(entry.match))?.rates;
}

function hasUsageTokenDetails(
  details: UsageTokenDetails | undefined,
): details is UsageTokenDetails {
  return Boolean(
    details &&
    ((details.inputTextTokens ?? 0) > 0 ||
      (details.inputImageTokens ?? 0) > 0 ||
      (details.outputTextTokens ?? 0) > 0 ||
      (details.outputImageTokens ?? 0) > 0 ||
      (details.outputThinkingTokens ?? 0) > 0),
  );
}

// ── Cost estimation ──────────────────────────────────────────────────────

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  options: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    tokenDetails?: UsageTokenDetails;
  } = {},
): number {
  if (isZeroCostModel(model)) {
    return 0;
  }

  const modalityRates = resolveModalityCostRates(model);
  if (modalityRates && hasUsageTokenDetails(options.tokenDetails)) {
    const inputTextTokens = Math.max(0, options.tokenDetails.inputTextTokens ?? 0);
    const inputImageTokens = Math.max(0, options.tokenDetails.inputImageTokens ?? 0);
    const outputTextTokens = Math.max(0, options.tokenDetails.outputTextTokens ?? 0);
    const outputImageTokens = Math.max(0, options.tokenDetails.outputImageTokens ?? 0);
    const outputThinkingTokens = Math.max(0, options.tokenDetails.outputThinkingTokens ?? 0);

    let remainingCacheReadTokens = Math.max(0, Math.min(inputTokens, options.cacheReadTokens ?? 0));
    const cacheReadTextTokens = Math.min(inputTextTokens, remainingCacheReadTokens);
    remainingCacheReadTokens -= cacheReadTextTokens;
    const cacheReadImageTokens = Math.min(inputImageTokens, remainingCacheReadTokens);

    const billableInputTextTokens = Math.max(0, inputTextTokens - cacheReadTextTokens);
    const billableInputImageTokens = Math.max(0, inputImageTokens - cacheReadImageTokens);
    const billableFallbackInputTokens = Math.max(
      0,
      inputTokens - inputTextTokens - inputImageTokens,
    );
    const billableFallbackOutputTokens = Math.max(
      0,
      outputTokens - outputTextTokens - outputImageTokens - outputThinkingTokens,
    );

    return (
      (billableInputTextTokens / 1_000_000) * modalityRates.inputText +
      (billableInputImageTokens / 1_000_000) *
        (modalityRates.inputImage ?? modalityRates.inputText) +
      (cacheReadTextTokens / 1_000_000) * (modalityRates.cacheReadText ?? modalityRates.inputText) +
      (cacheReadImageTokens / 1_000_000) *
        (modalityRates.cacheReadImage ?? modalityRates.inputImage ?? modalityRates.inputText) +
      (billableFallbackInputTokens / 1_000_000) * modalityRates.inputText +
      (outputTextTokens / 1_000_000) * modalityRates.outputText +
      (outputThinkingTokens / 1_000_000) *
        (modalityRates.outputThinking ?? modalityRates.outputText) +
      (outputImageTokens / 1_000_000) * (modalityRates.outputImage ?? modalityRates.outputText) +
      (billableFallbackOutputTokens / 1_000_000) * modalityRates.outputText
    );
  }

  const resolvedRates = resolveCostRates(model, inputTokens);
  if (resolvedRates) {
    const cacheReadTokens = Math.max(0, Math.min(inputTokens, options.cacheReadTokens ?? 0));
    const remainingInputTokens = Math.max(0, inputTokens - cacheReadTokens);
    const cacheWriteTokens = Math.max(
      0,
      Math.min(remainingInputTokens, options.cacheWriteTokens ?? 0),
    );
    const billableInputTokens = Math.max(0, remainingInputTokens - cacheWriteTokens);

    return (
      (billableInputTokens / 1_000_000) * resolvedRates.input +
      (outputTokens / 1_000_000) * resolvedRates.output +
      (cacheReadTokens / 1_000_000) * (resolvedRates.cacheRead ?? resolvedRates.input) +
      (cacheWriteTokens / 1_000_000) * (resolvedRates.cacheWrite ?? resolvedRates.input)
    );
  }

  // Default: assume $1/1M input, $3/1M output
  return (inputTokens / 1_000_000) * 1 + (outputTokens / 1_000_000) * 3;
}

export function isZeroCostModel(model: string): boolean {
  return Boolean(getLocalLlmCatalogEntry(model));
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
    provider: '', // Can be enriched later
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
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
