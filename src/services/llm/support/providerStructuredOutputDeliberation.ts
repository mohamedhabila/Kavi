import type { LlmProviderFamily } from '../../../types/provider';
import { isGemini3OrLaterModel } from '../catalog/providerCapabilities';

type StructuredOutputDeliberationControls = {
  reasoning_effort: 'none';
  thinking?: Record<string, unknown>;
};

interface StructuredOutputDeliberationParams {
  model: string;
  providerFamily?: LlmProviderFamily;
}

export function resolveProviderStructuredOutputDeliberationControls(
  params: StructuredOutputDeliberationParams,
): StructuredOutputDeliberationControls {
  const lowerModel = params.model.trim().toLowerCase();

  if (params.providerFamily === 'gemini') {
    // LOW is the least level every Gemini 3+ model accepts (3.8 Flash and 4 reject MINIMAL).
    if (isGemini3OrLaterModel(params.model)) {
      return {
        reasoning_effort: 'none',
        thinking: {
          thinkingLevel: 'LOW',
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
