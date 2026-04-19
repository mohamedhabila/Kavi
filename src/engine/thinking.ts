// ---------------------------------------------------------------------------
// Kavi — Thinking Level Control
// ---------------------------------------------------------------------------

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ThinkingConfig {
  level: ThinkingLevel;
}

export interface ThinkingParamsOptions {
  maxTokens?: number;
}

type AnthropicEffort = 'low' | 'medium' | 'high' | 'max';

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

function supportsAnthropicAdaptiveThinking(model: string): boolean {
  const lower = model.toLowerCase();
  return (
    lower.includes('claude-opus-4-7') ||
    lower.includes('claude-opus-4-6') ||
    lower.includes('claude-sonnet-4-6')
  );
}

function resolveAnthropicAdaptiveEffort(level: ThinkingLevel, model: string): AnthropicEffort {
  const lower = model.toLowerCase();
  const supportsMaxEffort =
    lower.includes('claude-opus-4-7') || lower.includes('claude-opus-4-6');

  switch (level) {
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'xhigh':
      return supportsMaxEffort ? 'max' : 'high';
    case 'high':
    default:
      return 'high';
  }
}

function resolveGeminiThinkingLevel(level: ThinkingLevel, model: string): GeminiThinkingLevel {
  const lower = model.toLowerCase();
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
  const lower = model.toLowerCase();
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
  const lower = model.toLowerCase();

  if (lower.includes('gemini')) {
    if (lower.includes('gemini-3')) {
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

  // Claude 4.6 models: adaptive thinking + effort.
  // Older Claude models: manual budget_tokens mode.
  if (lower.includes('claude')) {
    if (supportsAnthropicAdaptiveThinking(lower)) {
      return {
        thinking: {
          type: 'adaptive',
        },
        output_config: {
          effort: resolveAnthropicAdaptiveEffort(level, lower),
        },
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
  if (
    lower.includes('o1') ||
    lower.includes('o3') ||
    lower.includes('o4') ||
    lower.startsWith('gpt-5')
  ) {
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
