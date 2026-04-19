import type { LlmProviderConfig } from '../../types';
import { isOnDeviceLlmProvider } from '../localLlm/runtime';
import { getProviderApiKey } from '../storage/SecureStorage';

type ProviderModelConfig = Pick<LlmProviderConfig, 'model' | 'availableModels' | 'hiddenModels'> &
  Partial<Pick<LlmProviderConfig, 'baseUrl' | 'name'>>;

function normalizeModelId(model: string | null | undefined): string {
  return typeof model === 'string' ? model.trim() : '';
}

function resolveModelFamily(model: string): 'openai' | 'anthropic' | 'gemini' | undefined {
  const normalizedModel = model.toLowerCase();

  if (
    normalizedModel.startsWith('gpt-') ||
    normalizedModel.startsWith('o1') ||
    normalizedModel.startsWith('o3') ||
    normalizedModel.startsWith('o4') ||
    normalizedModel.startsWith('openai/')
  ) {
    return 'openai';
  }

  if (normalizedModel.includes('claude') || normalizedModel.startsWith('anthropic/')) {
    return 'anthropic';
  }

  if (normalizedModel.includes('gemini') || normalizedModel.startsWith('google/')) {
    return 'gemini';
  }

  return undefined;
}

function resolveProviderFamily(
  provider: ProviderModelConfig,
): 'openai' | 'anthropic' | 'gemini' | undefined {
  const normalizedBaseUrl = (provider.baseUrl || '').toLowerCase();
  if (normalizedBaseUrl.includes('openai.com')) {
    return 'openai';
  }

  if (normalizedBaseUrl.includes('anthropic.com')) {
    return 'anthropic';
  }

  if (
    normalizedBaseUrl.includes('generativelanguage.googleapis.com') ||
    normalizedBaseUrl.includes('aiplatform.googleapis.com')
  ) {
    return 'gemini';
  }

  const normalizedName = (provider.name || '').trim().toLowerCase();
  if (normalizedName === 'openai') {
    return 'openai';
  }

  if (normalizedName === 'anthropic') {
    return 'anthropic';
  }

  if (normalizedName === 'gemini') {
    return 'gemini';
  }

  return undefined;
}

function getSupportedProviderModels(provider: ProviderModelConfig): Set<string> {
  const models = new Set<string>();

  const addModels = (value: unknown): void => {
    if (!Array.isArray(value)) {
      return;
    }

    for (const entry of value) {
      const normalizedEntry = normalizeModelId(typeof entry === 'string' ? entry : undefined);
      if (normalizedEntry) {
        models.add(normalizedEntry);
      }
    }
  };

  const normalizedDefaultModel = normalizeModelId(provider.model);
  if (normalizedDefaultModel) {
    models.add(normalizedDefaultModel);
  }

  addModels(provider.availableModels);
  addModels(provider.hiddenModels);

  return models;
}

export function isProviderModelSupported(
  provider: ProviderModelConfig,
  model: string | null | undefined,
): boolean {
  const normalizedModel = normalizeModelId(model);
  if (!normalizedModel) {
    return false;
  }

  const supportedModels = getSupportedProviderModels(provider);
  if (supportedModels.size === 0 || supportedModels.has(normalizedModel)) {
    return true;
  }

  if (supportedModels.size > 1) {
    return false;
  }

  const providerFamily = resolveProviderFamily(provider);
  if (!providerFamily) {
    return true;
  }

  const requestedFamily = resolveModelFamily(normalizedModel);
  return !!providerFamily && providerFamily === requestedFamily;
}

export function resolveProviderModelSelection(
  provider: ProviderModelConfig,
  preferredModel?: string | null,
  fallbackModel?: string | null,
): string {
  const normalizedPreferredModel = normalizeModelId(preferredModel);
  if (normalizedPreferredModel && isProviderModelSupported(provider, normalizedPreferredModel)) {
    return normalizedPreferredModel;
  }

  const normalizedFallbackModel = normalizeModelId(fallbackModel);
  if (normalizedFallbackModel && isProviderModelSupported(provider, normalizedFallbackModel)) {
    return normalizedFallbackModel;
  }

  return normalizeModelId(provider.model) || normalizedFallbackModel || normalizedPreferredModel;
}

export function providerRequiresApiKey(
  provider: Pick<LlmProviderConfig, 'kind' | 'local'>,
): boolean {
  return !isOnDeviceLlmProvider(provider);
}

export async function resolveProviderApiKey(
  provider: Pick<LlmProviderConfig, 'id' | 'apiKey' | 'kind' | 'local'>,
): Promise<string> {
  if (!providerRequiresApiKey(provider)) {
    return provider.apiKey || '';
  }

  return (await getProviderApiKey(provider.id)) || provider.apiKey || '';
}

export async function hydrateProviderForRequest<T extends LlmProviderConfig>(
  provider: T,
): Promise<T> {
  const apiKey = await resolveProviderApiKey(provider);
  return apiKey === provider.apiKey ? provider : { ...provider, apiKey };
}

export function assertProviderReadyForRequest(
  provider: Pick<LlmProviderConfig, 'apiKey' | 'kind' | 'local' | 'name'>,
  label?: string,
): void {
  if (!providerRequiresApiKey(provider)) {
    return;
  }

  if ((provider.apiKey || '').trim()) {
    return;
  }

  const providerLabel =
    label?.trim() || (provider.name ? `Provider "${provider.name}"` : 'Provider');
  throw new Error(`${providerLabel} has no API key configured.`);
}

export function resolveEnabledProvider(
  providers: readonly LlmProviderConfig[],
  preferredProviderId?: string | null,
): LlmProviderConfig | undefined {
  if (preferredProviderId) {
    const preferred = providers.find(
      (provider) => provider.id === preferredProviderId && provider.enabled,
    );
    if (preferred) {
      return preferred;
    }
  }

  return providers.find((provider) => provider.enabled);
}

export function resolveConversationStartSelection(
  providers: readonly LlmProviderConfig[],
  preferredProviderId?: string | null,
  preferredModel?: string | null,
): { provider: LlmProviderConfig; providerId: string; model: string } | undefined {
  const provider = resolveEnabledProvider(providers, preferredProviderId);
  if (!provider) {
    return undefined;
  }

  const trimmedPreferredModel = typeof preferredModel === 'string' ? preferredModel.trim() : '';
  const model = resolveProviderModelSelection(
    provider,
    provider.id === preferredProviderId ? trimmedPreferredModel : undefined,
    provider.model,
  );

  return {
    provider,
    providerId: provider.id,
    model,
  };
}

export function resolveConversationModel(
  provider:
    | Pick<LlmProviderConfig, 'id' | 'model' | 'availableModels' | 'hiddenModels'>
    | undefined,
  options: {
    conversationModel?: string | null;
    activeProviderId?: string | null;
    activeModel?: string | null;
  },
): string {
  if (!provider) {
    return '';
  }

  const trimmedConversationModel =
    typeof options.conversationModel === 'string' ? options.conversationModel.trim() : '';
  const trimmedActiveModel =
    typeof options.activeModel === 'string' ? options.activeModel.trim() : '';

  return resolveProviderModelSelection(
    provider,
    trimmedConversationModel ||
      (provider.id === options.activeProviderId ? trimmedActiveModel : undefined),
    provider.model,
  );
}
