import type { LlmProviderConfig } from '../../types/provider';
import { resolveToolProviderFamily } from './toolManagerProvider';

function normalizeWorkerModel(model?: string | null): string | undefined {
  if (typeof model !== 'string') {
    return undefined;
  }

  const trimmed = model.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveWorkerProviderFamily(
  provider: Pick<
    LlmProviderConfig,
    'id' | 'name' | 'baseUrl' | 'model' | 'kind' | 'providerFamily'
  >,
) {
  return resolveToolProviderFamily(
    provider.name || provider.id,
    provider.baseUrl,
    provider.model,
    provider.kind,
    provider.providerFamily,
  );
}

function isWorkerModelCompatible(
  provider: Pick<
    LlmProviderConfig,
    | 'id'
    | 'name'
    | 'baseUrl'
    | 'model'
    | 'availableModels'
    | 'hiddenModels'
    | 'kind'
    | 'providerFamily'
  >,
  model?: string | null,
): boolean {
  const normalizedModel = normalizeWorkerModel(model);
  if (!normalizedModel) {
    return false;
  }

  const availableModels = provider.availableModels || [];
  const hiddenModels = provider.hiddenModels || [];
  if (availableModels.includes(normalizedModel) || hiddenModels.includes(normalizedModel)) {
    return true;
  }

  const providerFamily = resolveWorkerProviderFamily(provider);
  const family = resolveToolProviderFamily('', undefined, normalizedModel);
  const modelFamily = family === 'default' ? null : family;
  if (!modelFamily) {
    return true;
  }

  return modelFamily === providerFamily;
}

export function resolveSpawnWorkerModel(
  provider: Pick<
    LlmProviderConfig,
    | 'id'
    | 'name'
    | 'baseUrl'
    | 'model'
    | 'availableModels'
    | 'hiddenModels'
    | 'kind'
    | 'providerFamily'
  >,
  inheritedModel?: string | null,
): string {
  const normalizedInheritedModel = normalizeWorkerModel(inheritedModel);
  if (normalizedInheritedModel && isWorkerModelCompatible(provider, normalizedInheritedModel)) {
    return normalizedInheritedModel;
  }

  return normalizeWorkerModel(provider.model) || provider.model;
}

export function resolveFollowUpWorkerModel(
  provider: Pick<
    LlmProviderConfig,
    | 'id'
    | 'name'
    | 'baseUrl'
    | 'model'
    | 'availableModels'
    | 'hiddenModels'
    | 'kind'
    | 'providerFamily'
  >,
  storedModel?: string | null,
  inheritedModel?: string | null,
): string {
  const normalizedStoredModel = normalizeWorkerModel(storedModel);
  if (normalizedStoredModel && isWorkerModelCompatible(provider, normalizedStoredModel)) {
    return normalizedStoredModel;
  }

  const normalizedInheritedModel = normalizeWorkerModel(inheritedModel);
  if (normalizedInheritedModel && isWorkerModelCompatible(provider, normalizedInheritedModel)) {
    return normalizedInheritedModel;
  }

  return normalizeWorkerModel(provider.model) || provider.model;
}

export function mergeWorkerProviderIntoCatalog(
  allProviders: LlmProviderConfig[] | undefined,
  provider: LlmProviderConfig,
): LlmProviderConfig[] | undefined {
  if (!allProviders?.length) {
    return undefined;
  }

  let replaced = false;
  const mergedProviders = allProviders.map((entry) => {
    if (entry.id !== provider.id) {
      return entry;
    }

    replaced = true;
    return { ...entry, ...provider };
  });

  return replaced ? mergedProviders : [...mergedProviders, provider];
}
