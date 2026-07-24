import type { Conversation } from '../../../types/conversation';
import type { LlmProviderConfig } from '../../../types/provider';
import { isOnDeviceLlmProvider } from '../../localLlm/provider';
import { getProviderApiKey } from '../../storage/SecureStorage';
import {
  resolveModelHostedFamily,
  resolveProviderFamily as resolveConfiguredProviderFamily,
} from '../catalog/providerFamilies';

type ProviderModelConfig = Pick<LlmProviderConfig, 'model' | 'availableModels' | 'hiddenModels'> &
  Partial<Pick<LlmProviderConfig, 'providerFamily'>>;

function normalizeModelId(model: string | null | undefined): string {
  return typeof model === 'string' ? model.trim() : '';
}

function resolveModelFamily(model: string) {
  return resolveModelHostedFamily(model);
}

function resolveProviderFamily(provider: ProviderModelConfig) {
  return provider.providerFamily || 'custom';
}

function providerAcceptsHostedModelFamilies(
  providerFamily: ReturnType<typeof resolveProviderFamily> | undefined,
): boolean {
  return (
    providerFamily === 'openrouter' ||
    providerFamily === 'deepseek' ||
    providerFamily === 'qwen' ||
    providerFamily === 'kimi' ||
    providerFamily === 'ollama' ||
    providerFamily === 'custom'
  );
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

  const providerFamily = resolveProviderFamily(provider);
  const requestedFamily = resolveModelFamily(normalizedModel);
  if (providerFamily && requestedFamily) {
    return providerFamily === requestedFamily || providerAcceptsHostedModelFamilies(providerFamily);
  }

  return false;
}

export function resolveProviderModelSelection(
  provider: ProviderModelConfig,
  preferredModel?: string | null,
  fallbackModel?: string | null,
): string {
  const normalizedPreferredModel = normalizeModelId(preferredModel);
  const normalizedFallbackModel = normalizeModelId(fallbackModel);

  // Preserve explicit model locks requested by the caller even when the
  // provider advertises a narrower model list.
  if (
    normalizedPreferredModel &&
    normalizedFallbackModel &&
    normalizedPreferredModel === normalizedFallbackModel
  ) {
    return normalizedPreferredModel;
  }

  if (normalizedPreferredModel && isProviderModelSupported(provider, normalizedPreferredModel)) {
    return normalizedPreferredModel;
  }

  if (normalizedFallbackModel && isProviderModelSupported(provider, normalizedFallbackModel)) {
    return normalizedFallbackModel;
  }

  return normalizeModelId(provider.model) || normalizedFallbackModel || normalizedPreferredModel;
}

type ProviderAuthenticationConfig = Pick<LlmProviderConfig, 'kind' | 'local'> &
  Partial<Pick<LlmProviderConfig, 'name' | 'baseUrl' | 'providerFamily'>>;

function isLoopbackProvider(baseUrl: string | undefined): boolean {
  const normalizedUrl = (baseUrl || '').trim();
  if (!normalizedUrl) {
    return false;
  }

  try {
    const hostname = new URL(normalizedUrl).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export function providerRequiresApiKey(provider: ProviderAuthenticationConfig): boolean {
  if (isOnDeviceLlmProvider(provider) || isLoopbackProvider(provider.baseUrl)) {
    return false;
  }

  return (
    resolveConfiguredProviderFamily({
      name: provider.name || '',
      baseUrl: provider.baseUrl || '',
      providerFamily: provider.providerFamily,
    }) !== 'ollama'
  );
}

export async function resolveProviderApiKey(
  provider: Pick<LlmProviderConfig, 'id' | 'apiKey' | 'kind' | 'local'> &
    Partial<Pick<LlmProviderConfig, 'name' | 'baseUrl' | 'providerFamily'>>,
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

export function bindProviderToModel<T extends Pick<LlmProviderConfig, 'model'>>(
  provider: T,
  model: string | null | undefined,
): T {
  const normalizedModel = normalizeModelId(model);
  if (!normalizedModel || normalizeModelId(provider.model) === normalizedModel) {
    return provider;
  }

  return {
    ...provider,
    model: normalizedModel,
  };
}

export function assertProviderReadyForRequest(
  provider: Pick<LlmProviderConfig, 'apiKey' | 'kind' | 'local' | 'name'> &
    Partial<Pick<LlmProviderConfig, 'baseUrl' | 'providerFamily'>>,
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
    | Pick<
        LlmProviderConfig,
        'id' | 'model' | 'availableModels' | 'hiddenModels' | 'providerFamily'
      >
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

export type ResolvedConversationProviderContext = {
  provider: LlmProviderConfig;
  model: string;
  systemPromptText: string;
};

export async function resolveConversationProviderContext(params: {
  activeModel?: string | null;
  activeProviderId?: string | null;
  conversation: Pick<Conversation, 'providerId' | 'modelOverride' | 'systemPrompt'>;
  providers: readonly LlmProviderConfig[];
  systemPrompt: string;
}): Promise<ResolvedConversationProviderContext | undefined> {
  const provider = resolveEnabledProvider(
    params.providers,
    params.conversation.providerId || params.activeProviderId,
  );
  if (!provider) {
    return undefined;
  }

  const model = resolveConversationModel(provider, {
    conversationModel: params.conversation.modelOverride,
    activeProviderId: params.activeProviderId,
    activeModel: params.activeModel,
  });
  if (!model) {
    return undefined;
  }

  const hydratedProvider = await hydrateProviderForRequest(provider);
  if (providerRequiresApiKey(hydratedProvider) && !hydratedProvider.apiKey) {
    return undefined;
  }

  return {
    provider: bindProviderToModel(hydratedProvider, model),
    model,
    systemPromptText: params.conversation.systemPrompt || params.systemPrompt,
  };
}
