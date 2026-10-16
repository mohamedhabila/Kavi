// ---------------------------------------------------------------------------
// Kavi — Thinking Level Control
// ---------------------------------------------------------------------------

import { isGemini3OrLaterModel } from '../services/llm/catalog/providerCapabilities';
import { resolveModelHostedFamily } from '../services/llm/catalog/providerFamilies';
import type { ModelReasoningCapability } from '../types/tool';
import { resolveThinkingLevelReasoningEffort } from '../services/llm/support/reasoningEffortResolution';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ThinkingParamsOptions {
  maxTokens?: number;
  /** Reasoning efforts the provider declares for this model, when discovery recorded them. */
  reasoningCapability?: ModelReasoningCapability;
}

type GeminiThinkingLevel = 'low' | 'medium' | 'high';

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
 * LOW is the least level every Gemini 3+ model accepts: Gemini 3.8 Flash and 4 Argon reject
 * MINIMAL, and Gemini 4 cannot turn thinking off.
 */
function resolveGeminiThinkingLevel(level: ThinkingLevel): GeminiThinkingLevel {
  switch (level) {
    case 'off':
    case 'minimal':
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
 * Claude's thinking for a level, from the modes and efforts the model's models API declares:
 * adaptive thinking at the nearest declared effort, manual thinking with a budget where that
 * is the only mode, and thinking off where the model can turn it off. A model that always
 * thinks runs at its least effort when the level is off. With no level chosen, adaptive
 * thinking runs at the model's own default effort.
 */
function declaredClaudeThinking(
  capability: ModelReasoningCapability,
  level: ThinkingLevel | undefined,
  maxTokens: number | undefined,
): Record<string, unknown> {
  const modes = capability.thinkingModes ?? [];
  if (level === undefined) {
    return modes.includes('adaptive') ? { thinking: { type: 'adaptive' } } : {};
  }
  if (level === 'off' && !capability.mandatory) {
    return modes.includes('disabled') ? { thinking: { type: 'disabled' } } : {};
  }
  if (modes.includes('adaptive')) {
    const effort =
      capability.supportedEfforts.length > 0
        ? resolveThinkingLevelReasoningEffort({ ...capability, mandatory: true }, level)
        : undefined;
    return { thinking: { type: 'adaptive' }, ...(effort ? { output_config: { effort } } : {}) };
  }
  if (modes.includes('enabled')) {
    const budget = resolveAnthropicThinkingBudget(level === 'off' ? 'minimal' : level, maxTokens);
    return budget ? { thinking: { type: 'enabled', budget_tokens: budget } } : {};
  }
  return {};
}

/**
 * A thinking level as the provider's request parameters. With no level chosen the request
 * carries no effort or budget, so the model thinks as its vendor calibrated it by default:
 * Claude Sonnet 5.5 at high effort, Claude Opus 5.5 and Haiku 5.5 at medium. A fixed
 * medium sent for every model held Sonnet 5.5 a level below that, and lower effort means
 * fewer tool calls: on frozen final steps of Claw-Anything tasks, Sonnet 5.5 at medium read
 * on in the person's apps 4 times in 40, at its default 22.
 */
export function getThinkingParams(
  level: ThinkingLevel | undefined,
  model: string,
  options: ThinkingParamsOptions = {},
): Record<string, unknown> {
  const lower = normalizeModel(model);
  const hostedFamily = resolveModelHostedFamily(model);

  // A model whose reasoning controls are known (declared by its provider, or for OpenAI read
  // from its generation: getModelReasoningCapability) is driven by them.
  // A chosen level maps to the nearest effort the model accepts, so `off` turns reasoning
  // off where the model allows it and asks for its least deliberation where it does not.
  if (options.reasoningCapability?.thinkingModes) {
    return declaredClaudeThinking(options.reasoningCapability, level, options.maxTokens);
  }
  if (level === undefined) {
    // Gemini 3+ always thinks; asking only for its thought summaries keeps them shown.
    return hostedFamily === 'gemini' && isGemini3OrLaterModel(model)
      ? { thinking: { includeThoughts: true } }
      : {};
  }
  if (options.reasoningCapability) {
    const effort = resolveThinkingLevelReasoningEffort(options.reasoningCapability, level);
    return effort ? { reasoning_effort: effort } : {};
  }

  if (hostedFamily === 'gemini') {
    if (isGemini3OrLaterModel(model)) {
      return {
        thinking: {
          thinkingLevel: resolveGeminiThinkingLevel(level),
        },
      };
    }

    return {
      thinking: {
        thinkingBudget: resolveGeminiThinkingBudget(level, lower),
      },
    };
  }

  // A Claude model whose thinking modes are not known yet (its catalog not discovered) is
  // asked for nothing: every Claude model accepts a request without thinking parameters.
  if (hostedFamily === 'anthropic') {
    return {};
  }

  if (level === 'off') {
    return {};
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
