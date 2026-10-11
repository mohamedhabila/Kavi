import type { LlmProviderFamily, LlmProviderKind } from '../../types/provider';
import {
  resolveModelHostedFamily,
  resolveProviderFamily as resolveConfiguredProviderFamily,
} from '../../services/llm/catalog/providerFamilies';

const KNOWN_TOOL_PROVIDER_FAMILIES: ReadonlySet<string> = new Set([
  'openai',
  'anthropic',
  'openrouter',
  'ollama',
  'gemini',
  'on-device',
]);

export type ToolProviderFamily =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'ollama'
  | 'openrouter'
  | 'on-device'
  | 'default';

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

  return (KNOWN_TOOL_PROVIDER_FAMILIES.has(lower) ? lower : 'default') as ToolProviderFamily;
}
