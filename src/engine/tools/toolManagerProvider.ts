import type { LlmProviderFamily, LlmProviderKind } from '../../types/provider';
import {
  resolveModelHostedFamily,
  resolveProviderFamily as resolveConfiguredProviderFamily,
} from '../../services/llm/catalog/providerFamilies';

export const PROVIDER_TOOL_LIMITS: Record<string, number> = {
  openai: 128,
  anthropic: 64,
  openrouter: 128,
  ollama: 64,
  gemini: 20,
  'on-device': 12,
  default: 128,
};

export type ToolProviderFamily =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'ollama'
  | 'openrouter'
  | 'on-device'
  | 'default';

export const PROVIDER_INITIAL_TOOL_SOFT_LIMITS: Record<ToolProviderFamily, number> = {
  openai: 20,
  anthropic: 16,
  gemini: 12,
  ollama: 12,
  openrouter: 20,
  'on-device': 8,
  default: 20,
};

export const ON_DEVICE_TOOL_TOKEN_BUDGET = 1800;

function isOnDeviceToolProvider(providerKind?: LlmProviderKind): boolean {
  if (providerKind === 'on-device') {
    return true;
  }
  return false;
}

function mapHostedFamilyToToolFamily(
  family: LlmProviderFamily | undefined | null,
): ToolProviderFamily | null {
  switch (family) {
    case 'openai':
    case 'anthropic':
    case 'gemini':
    case 'ollama':
      return family;
    default:
      return null;
  }
}

function detectModelToolFamily(model?: string): ToolProviderFamily | null {
  return mapHostedFamilyToToolFamily(resolveModelHostedFamily(model));
}

function mapConfiguredProviderFamilyToToolFamily(params: {
  providerFamily?: LlmProviderFamily;
  model?: string;
  providerKind?: LlmProviderKind;
}): ToolProviderFamily | null {
  if (isOnDeviceToolProvider(params.providerKind)) {
    return 'on-device';
  }

  switch (params.providerFamily) {
    case 'openai':
    case 'anthropic':
    case 'gemini':
    case 'ollama':
      return params.providerFamily;
    case 'openrouter':
      return detectModelToolFamily(params.model) ?? 'openrouter';
    case undefined:
    case 'custom':
      return null;
    default:
      return detectModelToolFamily(params.model) ?? 'default';
  }
}

export function resolveToolProviderFamily(
  providerName: string,
  baseUrl?: string,
  model?: string,
  providerKind?: LlmProviderKind,
  providerFamily?: LlmProviderFamily,
): ToolProviderFamily {
  const lower = (providerName || '').toLowerCase();
  const modelFamily = detectModelToolFamily(model);

  const explicitFamily = mapConfiguredProviderFamilyToToolFamily({
    providerFamily,
    model,
    providerKind,
  });
  if (explicitFamily && providerFamily && providerFamily !== 'custom') {
    return explicitFamily;
  }

  if (isOnDeviceToolProvider(providerKind)) {
    return 'on-device';
  }

  const inferredProviderFamily = mapConfiguredProviderFamilyToToolFamily({
    providerFamily: resolveConfiguredProviderFamily({
      name: providerName,
      baseUrl: baseUrl || '',
      providerFamily,
    }),
    model,
    providerKind,
  });
  if (inferredProviderFamily && inferredProviderFamily !== 'default') {
    return inferredProviderFamily;
  }

  if (modelFamily) {
    return modelFamily;
  }

  return (PROVIDER_TOOL_LIMITS[lower] ? lower : 'default') as ToolProviderFamily;
}

export function getProviderToolLimit(
  providerName: string,
  baseUrl?: string,
  model?: string,
  providerKind?: LlmProviderKind,
  providerFamily?: LlmProviderFamily,
): number {
  const family = resolveToolProviderFamily(
    providerName,
    baseUrl,
    model,
    providerKind,
    providerFamily,
  );
  return PROVIDER_TOOL_LIMITS[family] ?? PROVIDER_TOOL_LIMITS.default;
}
