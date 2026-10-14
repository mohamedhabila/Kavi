import type { UsageTokenDetails } from '../../types/usage';
import { getLocalLlmCatalogEntry } from '../localLlm/catalog';

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

// Per 1M tokens, from each vendor's pricing page (2026-10-14). OpenAI's GPT-6 and GPT-5.6 rates
// double (output 1.5x) above 272K input tokens, and their cache writes cost 1.25x input. Gemini 4 Argon and 3.8/3.6 Flash carry launch
// prices: Argon $4/$20 from 2026-12-01, the Flash models $1.50/$7.50 from 2027-01-01.
const COST_TABLE: Record<string, ModelCostRates> = {
  'gpt-6-astra': {
    promptThreshold: 272_000,
    standard: { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },
    largePrompt: { input: 20, output: 75, cacheWrite: 25, cacheRead: 2 },
  },
  'gpt-6.1-sol': {
    promptThreshold: 272_000,
    standard: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
    largePrompt: { input: 4, output: 15, cacheWrite: 5, cacheRead: 0.2 },
  },
  'gpt-6-sol': {
    promptThreshold: 272_000,
    standard: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
    largePrompt: { input: 4, output: 15, cacheWrite: 5, cacheRead: 0.4 },
  },
  'gpt-6-luna': {
    promptThreshold: 272_000,
    standard: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
    largePrompt: { input: 0.2, output: 0.75, cacheWrite: 0.25, cacheRead: 0.02 },
  },
  'gpt-5.6-sol': {
    promptThreshold: 272_000,
    standard: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.4 },
    largePrompt: { input: 8, output: 30, cacheWrite: 10, cacheRead: 0.8 },
  },
  'gpt-5.6-terra': {
    promptThreshold: 272_000,
    standard: { input: 2, output: 12, cacheWrite: 2.5, cacheRead: 0.2 },
    largePrompt: { input: 4, output: 18, cacheWrite: 5, cacheRead: 0.4 },
  },
  'gpt-5.6-luna': {
    promptThreshold: 272_000,
    standard: { input: 0.2, output: 1.2, cacheWrite: 0.25, cacheRead: 0.02 },
    largePrompt: { input: 0.4, output: 1.8, cacheWrite: 0.5, cacheRead: 0.04 },
  },
  'gpt-5.5': { input: 5, output: 30, cacheRead: 0.5 },
  'gpt-5.4': { input: 2.5, output: 15 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5, cacheRead: 0.075 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  o1: { input: 15, output: 60 },
  o3: { input: 2, output: 8 },
  'o4-mini': { input: 1.1, output: 4.4 },
  // Cache write 1.25x input. Cache read 0.1x input, except 0.05x on Opus 5.5 and Sonnet 5.5
  // and 0.025x on Fable 5.1.
  'claude-fable-5-1': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  'claude-fable-5': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'gemini-4-argon': { input: 2, output: 10, cacheRead: 0.1 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75, cacheRead: 0.075 },
  'gemini-3.6-flash': { input: 0.75, output: 3.75, cacheRead: 0.075 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cacheRead: 0.03 },
  'gemini-3.5-flash': { input: 1.5, output: 9, cacheRead: 0.15 },
  'gemini-3.1-pro-preview': {
    promptThreshold: 200_000,
    standard: { input: 2, output: 12, cacheRead: 0.2 },
    largePrompt: { input: 4, output: 18, cacheRead: 0.4 },
  },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5, cacheRead: 0.025 },
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
    // gpt-image-2 and gpt-image-2.5 (sunburst, flare) share these rates.
    match: 'gpt-image-2',
    rates: {
      inputText: 5,
      outputText: 10,
      inputImage: 8,
      outputImage: 30,
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
    match: 'gemini-3.1-flash-image',
    rates: {
      inputText: 0.5,
      outputText: 3,
      inputImage: 0.5,
      outputImage: 60,
      outputThinking: 3,
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
    match: 'gemini-3-pro-image',
    rates: {
      inputText: 2,
      outputText: 12,
      inputImage: 2,
      outputImage: 120,
      outputThinking: 12,
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

  return (inputTokens / 1_000_000) * 1 + (outputTokens / 1_000_000) * 3;
}

export function isZeroCostModel(model: string): boolean {
  return Boolean(getLocalLlmCatalogEntry(model));
}

function isTieredCostRates(rates: ModelCostRates): rates is TieredCostRates {
  return 'promptThreshold' in rates;
}

// Longest key first, so claude-opus-5-5 takes its own row and not claude-opus-5's.
const COST_TABLE_KEYS_BY_SPECIFICITY = Object.keys(COST_TABLE).sort(
  (left, right) => right.length - left.length,
);

function resolveCostRates(model: string, inputTokens: number): FlatCostRates | undefined {
  const lower = model.toLowerCase();

  const key = COST_TABLE_KEYS_BY_SPECIFICITY.find((candidate) => lower.includes(candidate));
  if (key) {
    const rates = COST_TABLE[key];
    if (isTieredCostRates(rates)) {
      return inputTokens > rates.promptThreshold ? rates.largePrompt : rates.standard;
    }
    return rates;
  }

  if (lower.includes('gpt-5')) {
    if (lower.includes('mini') || lower.includes('nano')) {
      return COST_TABLE['gpt-5.4-mini'] as FlatCostRates;
    }
    if (lower.includes('5.5')) {
      return COST_TABLE['gpt-5.5'] as FlatCostRates;
    }
    return COST_TABLE['gpt-5.4'] as FlatCostRates;
  }

  if (lower === 'o4' || lower.startsWith('o4-')) {
    return COST_TABLE['o4-mini'] as FlatCostRates;
  }

  if (lower.includes('claude-opus-4')) {
    return COST_TABLE['claude-opus-4-7'] as FlatCostRates;
  }

  if (lower.includes('claude-sonnet-4')) {
    return COST_TABLE['claude-sonnet-4-6'] as FlatCostRates;
  }

  if (lower.includes('claude-haiku-4')) {
    return COST_TABLE['claude-haiku-4-5'] as FlatCostRates;
  }

  if (lower.includes('gemini-3.5-flash')) {
    return COST_TABLE['gemini-3.5-flash'] as FlatCostRates;
  }

  if (lower.includes('gemini-3') && lower.includes('pro')) {
    const rates = COST_TABLE['gemini-3.1-pro-preview'] as TieredCostRates;
    return inputTokens > rates.promptThreshold ? rates.largePrompt : rates.standard;
  }

  if (lower.includes('gemini-3.1-flash-lite')) {
    return COST_TABLE['gemini-3.1-flash-lite'] as FlatCostRates;
  }

  if (lower.includes('gemini-3') && lower.includes('flash')) {
    return COST_TABLE['gemini-3-flash-preview'] as FlatCostRates;
  }

  if (lower.includes('gemini-2.5-pro')) {
    const rates = COST_TABLE['gemini-2.5-pro'] as TieredCostRates;
    return inputTokens > rates.promptThreshold ? rates.largePrompt : rates.standard;
  }

  if (lower.includes('gemini-2.5-flash-lite')) {
    return COST_TABLE['gemini-2.5-flash-lite'] as FlatCostRates;
  }

  if (lower.includes('gemini-2.5-flash')) {
    return COST_TABLE['gemini-2.5-flash'] as FlatCostRates;
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
