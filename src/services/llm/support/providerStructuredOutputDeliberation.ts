import type { LlmProviderFamily } from '../../../types/provider';

type StructuredOutputDeliberationControls = {
  reasoning_effort: 'none';
  thinking?: Record<string, unknown>;
};

interface StructuredOutputDeliberationParams {
  model: string;
  providerFamily?: LlmProviderFamily;
}

function isGemini3Model(lowerModel: string): boolean {
  return /gemini[- ]?3(?:[.-]|$)/i.test(lowerModel);
}

export function resolveProviderStructuredOutputDeliberationControls(
  params: StructuredOutputDeliberationParams,
): StructuredOutputDeliberationControls {
  const lowerModel = params.model.trim().toLowerCase();

  if (params.providerFamily === 'anthropic') {
    return {
      reasoning_effort: 'none',
      thinking: {
        type: 'disabled',
      },
    };
  }

  if (params.providerFamily === 'gemini') {
    if (isGemini3Model(lowerModel)) {
      return {
        reasoning_effort: 'none',
        thinking: {
          thinkingLevel:
            lowerModel.includes('pro') && !lowerModel.includes('flash') ? 'LOW' : 'MINIMAL',
          includeThoughts: false,
        },
      };
    }

    if (lowerModel.includes('2.5-pro')) {
      return {
        reasoning_effort: 'none',
        thinking: {
          thinkingBudget: 128,
          includeThoughts: false,
        },
      };
    }

    return {
      reasoning_effort: 'none',
      thinking: {
        thinkingBudget: 0,
        includeThoughts: false,
      },
    };
  }

  return {
    reasoning_effort: 'none',
  };
}
