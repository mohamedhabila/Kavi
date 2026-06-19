import type { LlmProviderConfig } from '../../../types/provider';
import { resolveProviderRouting } from './providerProtocols';
import { normalizeHostedModelId, resolveModelHostedFamily } from './providerFamilies';

const GEMINI_STRUCTURED_OUTPUT_WITH_TOOLS_PATTERNS = [
  /^gemini-3(?:\.1|-)/i,
  /^gemini-3\.5-/i,
  /^google\/gemini-3(?:\.1|-)/i,
  /^google\/gemini-3\.5-/i,
] as const;

export function isOpenAIReasoningModel(model: string): boolean {
  return /^(?:o1|o3|o4|gpt-5)/i.test(normalizeHostedModelId(model));
}

export function isGemini3Model(model: string | undefined): boolean {
  return (
    resolveModelHostedFamily(model) === 'gemini' &&
    /^gemini-3(?:[.-]|$)/i.test(normalizeHostedModelId(model))
  );
}

export function isGeminiProModel(model: string | undefined): boolean {
  return (
    resolveModelHostedFamily(model) === 'gemini' &&
    /^gemini(?:-[^/]+)*-pro(?:[.-]|$)/i.test(normalizeHostedModelId(model))
  );
}

export function isAnthropicClaude4Model(model: string | undefined): boolean {
  return (
    resolveModelHostedFamily(model) === 'anthropic' &&
    /^claude-(?:opus|sonnet)-4(?:[.-]|$)/i.test(normalizeHostedModelId(model))
  );
}

export function isAnthropicClaude4OpusModel(model: string | undefined): boolean {
  return (
    resolveModelHostedFamily(model) === 'anthropic' &&
    /^claude-opus-4(?:[.-]|$)/i.test(normalizeHostedModelId(model))
  );
}

export function supportsAnthropicAdaptiveThinking(model: string | undefined): boolean {
  return (
    resolveModelHostedFamily(model) === 'anthropic' &&
    /^claude-sonnet-4-6(?:[.-]|$)/i.test(normalizeHostedModelId(model))
  );
}

export function supportsTemperature(model: string): boolean {
  return !/(?:^|\/)(?:o[134]|gpt-5(?:\.|$))/i.test(model);
}

export function shouldSurfaceReasoning(_model: string): boolean {
  return true;
}

export function supportsGeminiStructuredOutputWithTools(
  model: string,
  provider?: Pick<LlmProviderConfig, 'capabilityHints'>,
): boolean {
  if (provider?.capabilityHints?.supportsStructuredOutput === false) {
    return false;
  }

  return GEMINI_STRUCTURED_OUTPUT_WITH_TOOLS_PATTERNS.some((pattern) => pattern.test(model));
}

export function resolveProviderCapabilities(
  provider: Pick<
    LlmProviderConfig,
    'kind' | 'local' | 'name' | 'baseUrl' | 'protocol' | 'providerFamily' | 'capabilityHints'
  >,
  model: string,
): {
  routing: ReturnType<typeof resolveProviderRouting>;
  supportsTemperature: boolean;
  supportsReasoningEffort: boolean;
  supportsGeminiStructuredOutputWithTools: boolean;
} {
  return {
    routing: resolveProviderRouting(provider),
    supportsTemperature: supportsTemperature(model),
    supportsReasoningEffort: isOpenAIReasoningModel(model),
    supportsGeminiStructuredOutputWithTools: supportsGeminiStructuredOutputWithTools(
      model,
      provider,
    ),
  };
}
