import type { LlmProviderConfig } from '../../types/provider';
import {
  DEFAULT_LOCAL_LLM_MODEL_ID,
  ON_DEVICE_PROVIDER_NAME,
  getDefaultLocalLlmAccelerator,
  getLocalLlmCatalogEntriesForProvider,
  getLocalLlmModelCapabilities,
} from './catalog';
import { getLocalLlmRuntime, resolveLocalLlmAccelerator } from './backendPolicy';
import { normalizeInstalledModels } from './modelArtifacts';

export function isOnDeviceLlmProvider(
  provider: Pick<LlmProviderConfig, 'kind' | 'local'> | null | undefined,
): boolean {
  return provider?.kind === 'on-device' || Boolean(provider?.local?.runtime);
}

export function supportsOnDeviceLlmTools(
  provider:
    | Pick<LlmProviderConfig, 'kind' | 'local' | 'model' | 'modelCapabilities'>
    | null
    | undefined,
  modelId: string = provider?.model || DEFAULT_LOCAL_LLM_MODEL_ID,
): boolean {
  if (!isOnDeviceLlmProvider(provider)) {
    return false;
  }

  return (
    provider?.modelCapabilities?.[modelId]?.tools === true ||
    getLocalLlmModelCapabilities(modelId).tools
  );
}

export function getLocalLlmProviderModelIds(provider: LlmProviderConfig): string[] {
  return getLocalLlmCatalogEntriesForProvider(provider).map((entry) => entry.id);
}

export function createDefaultLocalLlmProvider(id: string): LlmProviderConfig {
  const catalogEntries = getLocalLlmCatalogEntriesForProvider(null);
  const availableModels = catalogEntries.map((entry) => entry.id);
  const defaultModel = availableModels[0] || DEFAULT_LOCAL_LLM_MODEL_ID;
  const modelCapabilities = Object.fromEntries(
    availableModels.map((modelId) => [modelId, getLocalLlmModelCapabilities(modelId)]),
  );

  return {
    id,
    kind: 'on-device',
    name: ON_DEVICE_PROVIDER_NAME,
    baseUrl: '',
    apiKey: '',
    model: defaultModel,
    availableModels,
    modelCapabilities,
    enabled: true,
    local: {
      runtime: getLocalLlmRuntime({ model: defaultModel, local: undefined }, defaultModel),
      backend: getDefaultLocalLlmAccelerator(defaultModel),
      catalogModelIds: availableModels,
      installedModels: [],
    },
  };
}

export function normalizeLocalLlmProvider(provider: LlmProviderConfig): LlmProviderConfig {
  if (!isOnDeviceLlmProvider(provider)) {
    return provider;
  }

  const catalog = getLocalLlmCatalogEntriesForProvider(provider);
  const availableModels = catalog.map((entry) => entry.id);
  const model = availableModels.includes(provider.model)
    ? provider.model
    : availableModels[0] || DEFAULT_LOCAL_LLM_MODEL_ID;
  const runtime = getLocalLlmRuntime(provider, model);
  const modelCapabilities = Object.fromEntries(
    availableModels.map((modelId) => [modelId, getLocalLlmModelCapabilities(modelId)]),
  );

  return {
    ...provider,
    kind: 'on-device',
    name: provider.name?.trim() || ON_DEVICE_PROVIDER_NAME,
    baseUrl: '',
    apiKey: '',
    model,
    availableModels,
    modelCapabilities,
    local: {
      runtime,
      backend: resolveLocalLlmAccelerator(provider, model),
      catalogModelIds: provider.local?.catalogModelIds || availableModels,
      installedModels: normalizeInstalledModels(provider),
    },
  };
}
