import type { NormalizedUsage, UsageTokenDetails } from '../../types/usage';

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
