// ---------------------------------------------------------------------------
// Kavi — Thinking Level Control
// ---------------------------------------------------------------------------

import type { AnthropicEffortLevel } from '../services/llm/catalog/providerCapabilities';
import {
  isOpenAIReasoningModel,
  rejectsThinkingParam,
  supportedEffortLevels,
  supportsAdaptiveThinking,
} from '../services/llm/catalog/providerCapabilities';
import { resolveModelHostedFamily } from '../services/llm/catalog/providerFamilies';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ThinkingConfig {
  level: ThinkingLevel;
}

export interface ThinkingParamsOptions {
  maxTokens?: number;
}

type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

/** Anthropic's `output_config.effort` tiers, in ascending order of intensity. */
const ANTHROPIC_EFFORT_ORDER: AnthropicEffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const ANTHROPIC_THINKING_BUDGETS: Record<Exclude<ThinkingLevel, 'off'>, number> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 32768,
  xhigh: 65536,
};

const ANTHROPIC_THINKING_ORDER: Array<Exclude<ThinkingLevel, 'off'>> = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

function normalizeModel(model: string): string {
  return model.toLowerCase();
}

function isGemini3Model(model: string): boolean {
  return /(?:^|\/)gemini[- ]?3(?:[.-]|$)/i.test(model);
}

function resolveAnthropicThinkingBudget(level: ThinkingLevel, maxTokens?: number): number | null {
  if (level === 'off') {
    return null;
  }

  const requestedBudget = ANTHROPIC_THINKING_BUDGETS[level];
  if (!Number.isFinite(maxTokens)) {
    return requestedBudget;
  }

  const tokenLimit = Math.floor(maxTokens as number);
  if (tokenLimit <= ANTHROPIC_THINKING_BUDGETS.minimal) {
    return null;
  }

  let resolvedBudget: number | null = null;
  for (const candidate of ANTHROPIC_THINKING_ORDER) {
    const candidateBudget = ANTHROPIC_THINKING_BUDGETS[candidate];
    if (candidateBudget > requestedBudget) {
      break;
    }
    if (candidateBudget < tokenLimit) {
      resolvedBudget = candidateBudget;
    }
  }

  return resolvedBudget;
}

/**
 * Maps a UI thinking-level chip to the `output_config.effort` tier to send for `model`,
 * degrading to the nearest tier the model actually supports rather than dropping or
 * rejecting an unsupported request. `undefined` means the model doesn't take an effort
 * value at all (`supportedEffortLevels` returned an empty set — e.g. a pre-4.6 model).
 *
 * The 'xhigh' chip — the strongest level the UI offers — always requests the model's
 * actual ceiling tier (the last entry of `supportedEffortLevels`), which is 'max' for
 * every current Anthropic generation. That preserves "top chip = strongest available
 * effort" regardless of whether a given model's range stops at 'max' (4.6) or has the
 * newer 'xhigh' tier in between 'high' and 'max' (4.7+, including every 5.x, and Fable) —
 * there is no separate UI chip for that in-between tier.
 */
function resolveAnthropicEffortForLevel(
  level: Exclude<ThinkingLevel, 'off'>,
  model: string,
): AnthropicEffortLevel | undefined {
  const supported = supportedEffortLevels(model);
  if (supported.length === 0) {
    return undefined;
  }

  const requestedTier: AnthropicEffortLevel =
    level === 'minimal' || level === 'low'
      ? 'low'
      : level === 'medium'
        ? 'medium'
        : level === 'high'
          ? 'high'
          : 'xhigh';

  if (supported.includes(requestedTier)) {
    return requestedTier;
  }

  // The 'xhigh' chip means "the strongest reasoning this model offers". A generation that
  // predates the 'xhigh' tier (4.6) still exposes 'max', so honor the intent there rather
  // than degrading to 'high'. 'max' is never chosen when the model supports 'xhigh'
  // itself, so a user's selection does not silently escalate to the costliest tier.
  if (requestedTier === 'xhigh' && supported.includes('max')) {
    return 'max';
  }

  // Degrade to the nearest supported tier at or below the requested one.
  const requestedRank = ANTHROPIC_EFFORT_ORDER.indexOf(requestedTier);
  for (let rank = requestedRank - 1; rank >= 0; rank -= 1) {
    const candidate = ANTHROPIC_EFFORT_ORDER[rank];
    if (supported.includes(candidate)) {
      return candidate;
    }
  }

  // Nothing at or below the requested rank is supported — use the model's lowest tier
  // rather than sending nothing.
  return supported[0];
}

function resolveGeminiThinkingLevel(level: ThinkingLevel, model: string): GeminiThinkingLevel {
  const lower = normalizeModel(model);
  const supportsMinimal = !lower.includes('pro');

  switch (level) {
    case 'off':
    case 'minimal':
      return supportsMinimal ? 'minimal' : 'low';
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
    case 'xhigh':
    default:
      return 'high';
  }
}

function resolveGeminiThinkingBudget(level: ThinkingLevel, model: string): number {
  const lower = normalizeModel(model);
  const isPro = lower.includes('pro');

  if (isPro) {
    const budgets: Record<ThinkingLevel, number> = {
      off: 128,
      minimal: 512,
      low: 2048,
      medium: 8192,
      high: 16384,
      xhigh: 32768,
    };
    return budgets[level];
  }

  const budgets: Record<ThinkingLevel, number> = {
    off: 0,
    minimal: 256,
    low: 1024,
    medium: 4096,
    high: 16384,
    xhigh: 24576,
  };
  return budgets[level];
}

/**
 * Map thinking level to provider-specific parameters
 */
export function getThinkingParams(
  level: ThinkingLevel,
  model: string,
  options: ThinkingParamsOptions = {},
): Record<string, unknown> {
  const lower = normalizeModel(model);
  const hostedFamily = resolveModelHostedFamily(model);

  if (hostedFamily === 'gemini') {
    if (isGemini3Model(model)) {
      return {
        thinking: {
          thinkingLevel: resolveGeminiThinkingLevel(level, lower),
        },
      };
    }

    return {
      thinking: {
        thinkingBudget: resolveGeminiThinkingBudget(level, lower),
      },
    };
  }

  if (level === 'off') {
    return {};
  }

  // Fable: thinking is always on server-side and takes no `thinking` param at all —
  // only `output_config.effort` is a valid lever.
  // Opus/Sonnet 4.6+ (including every 5.x): adaptive thinking + effort.
  // Everything older: manual budget_tokens mode (no effort concept).
  if (hostedFamily === 'anthropic') {
    if (level === 'minimal') {
      return {};
    }

    if (rejectsThinkingParam(model)) {
      const effort = resolveAnthropicEffortForLevel(level, model);
      return effort ? { output_config: { effort } } : {};
    }

    if (supportsAdaptiveThinking(model)) {
      const effort = resolveAnthropicEffortForLevel(level, model);
      return {
        thinking: {
          type: 'adaptive',
        },
        ...(effort ? { output_config: { effort } } : {}),
      };
    }

    const budget = resolveAnthropicThinkingBudget(level, options.maxTokens);
    if (!budget) {
      return {};
    }

    return {
      thinking: {
        type: 'enabled',
        budget_tokens: budget,
      },
    };
  }

  // OpenAI models: use reasoning_effort
  if (isOpenAIReasoningModel(model)) {
    const effortMap: Record<ThinkingLevel, string> = {
      off: 'low',
      minimal: 'low',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'high',
    };
    return {
      reasoning_effort: effortMap[level],
    };
  }

  // Other models: use temperature as a proxy
  const tempMap: Record<ThinkingLevel, number> = {
    off: 0.3,
    minimal: 0.3,
    low: 0.5,
    medium: 0.7,
    high: 1.0,
    xhigh: 1.0,
  };
  return { temperature: tempMap[level] };
}
