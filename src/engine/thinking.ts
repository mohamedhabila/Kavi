// ---------------------------------------------------------------------------
// Kavi — Thinking Level Control
// ---------------------------------------------------------------------------

import { isOpenAIReasoningModel } from '../services/llm/catalog/providerCapabilities';
import { resolveModelHostedFamily } from '../services/llm/catalog/providerFamilies';
import type { ModelReasoningCapability } from '../types/tool';
import { resolveThinkingLevelReasoningEffort } from '../services/llm/support/reasoningEffortResolution';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ThinkingConfig {
  level: ThinkingLevel;
}

export interface ThinkingParamsOptions {
  maxTokens?: number;
  /** Reasoning efforts the provider declares for this model, when discovery recorded them. */
  reasoningCapability?: ModelReasoningCapability;
}

type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

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
 * Claude's thinking for a level, from the modes and efforts the model's models API declares:
 * adaptive thinking at the nearest declared effort, manual thinking with a budget where that
 * is the only mode, and thinking off where the model can turn it off. A model that always
 * thinks runs at its least effort when the level is off.
 */
function declaredClaudeThinking(
  capability: ModelReasoningCapability,
  level: ThinkingLevel,
  maxTokens: number | undefined,
): Record<string, unknown> {
  const modes = capability.thinkingModes ?? [];
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
 * Map thinking level to provider-specific parameters
 */
export function getThinkingParams(
  level: ThinkingLevel,
  model: string,
  options: ThinkingParamsOptions = {},
): Record<string, unknown> {
  const lower = normalizeModel(model);
  const hostedFamily = resolveModelHostedFamily(model);

  // A model whose provider declares its reasoning controls is driven by those declarations.
  // The level maps to the nearest effort the model accepts, so `off` turns reasoning off
  // where the model allows it and asks for its least deliberation where it does not —
  // instead of leaving the model at its own default, which is often its highest.
  if (options.reasoningCapability?.thinkingModes) {
    return declaredClaudeThinking(options.reasoningCapability, level, options.maxTokens);
  }
  if (options.reasoningCapability) {
    const effort = resolveThinkingLevelReasoningEffort(options.reasoningCapability, level);
    return effort ? { reasoning_effort: effort } : {};
  }

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

  // A Claude model whose thinking modes are not known yet (its catalog not discovered) is
  // asked for nothing: every Claude model accepts a request without thinking parameters.
  if (hostedFamily === 'anthropic') {
    return {};
  }

  if (level === 'off') {
    return {};
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
