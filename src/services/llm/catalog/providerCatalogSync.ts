// ---------------------------------------------------------------------------
// Kavi — Provider model catalog sync
// ---------------------------------------------------------------------------
// Model discovery records what a provider declares about each model: input
// modalities, tool support, context window, and reasoning rules. Request building
// depends on those declarations — a model whose reasoning cannot be turned off
// rejects a request to turn it off — so they cannot wait for the user to open the
// model picker. This module merges a discovery result into the stored provider
// config and keeps the active provider's catalog current in the background.
// ---------------------------------------------------------------------------

import { useSettingsStore } from '../../../store/useSettingsStore';
import type { LlmProviderConfig } from '../../../types/provider';
import { createLogger } from '../../../utils/logger';
import { isOnDeviceLlmProvider } from '../../localLlm/provider';
import { getProviderApiKey } from '../../storage/SecureStorage';
import { performLlmFetch } from '../core/fetchTransport';
import { fetchLlmProviderModels } from '../modelService';
import type { ModelsWithCapabilities } from '../support/contracts';

const logger = createLogger('ProviderCatalogSync');

/** Folds a discovery result into a provider config, keeping entries discovery omitted. */
export function mergeDiscoveredModelCatalog(
  provider: LlmProviderConfig,
  discovered: ModelsWithCapabilities,
): LlmProviderConfig {
  return {
    ...provider,
    availableModels: discovered.models,
    modelCapabilities: {
      ...(provider.modelCapabilities ?? {}),
      ...discovered.capabilities,
    },
    modelContextWindows: {
      ...(provider.modelContextWindows ?? {}),
      ...discovered.contextWindows,
    },
  };
}

/**
 * True while nothing the provider declares about `model` has been recorded: no
 * reasoning rules and no advertised context window. Static presets fill in inferred
 * modalities for every listed model, so those alone say nothing about discovery.
 */
export function needsModelCatalogSync(provider: LlmProviderConfig, model: string): boolean {
  if (isOnDeviceLlmProvider(provider)) return false;
  return (
    provider.modelCapabilities?.[model]?.reasoning === undefined &&
    provider.modelContextWindows?.[model] === undefined
  );
}

const attemptedSyncKeys = new Set<string>();

function syncKey(providerId: string, model: string): string {
  return `${providerId}\u0000${model}`;
}

/**
 * Discovers the active provider's model catalog when the active model has no recorded
 * declarations yet. Each provider/model pair is attempted once per launch, so a model
 * whose provider declares nothing costs one models request rather than one per turn.
 */
export async function syncActiveProviderModelCatalog(): Promise<void> {
  const state = useSettingsStore.getState();
  const provider = state.providers.find(
    (candidate) => candidate.id === state.activeProviderId && candidate.enabled,
  );
  const model = state.activeModel || provider?.model;
  if (!provider || !model || !needsModelCatalogSync(provider, model)) return;
  const key = syncKey(provider.id, model);
  if (attemptedSyncKeys.has(key)) return;
  attemptedSyncKeys.add(key);

  try {
    const apiKey = (await getProviderApiKey(provider.id)) || provider.apiKey;
    const discovered = await fetchLlmProviderModels({
      provider: { ...provider, apiKey },
      performFetch: performLlmFetch,
    });
    if (discovered.models.length === 0) return;
    // Merge into the stored config as it is now: the user may have edited the provider
    // while discovery ran, and the stored copy never carries the secret key.
    const latest = useSettingsStore.getState().providers.find((entry) => entry.id === provider.id);
    if (!latest) return;
    useSettingsStore.getState().updateProvider(mergeDiscoveredModelCatalog(latest, discovered));
  } catch (error: unknown) {
    logger.warn('Model catalog sync failed', {
      providerId: provider.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Syncs now and again whenever the user switches the active provider or model. */
export function startActiveProviderModelCatalogSync(): () => void {
  void syncActiveProviderModelCatalog();
  return useSettingsStore.subscribe((state, previous) => {
    if (
      state.activeProviderId !== previous.activeProviderId ||
      state.activeModel !== previous.activeModel
    ) {
      void syncActiveProviderModelCatalog();
    }
  });
}

/** Clears the once-per-launch attempt record. */
export function resetProviderModelCatalogSyncForTests(): void {
  attemptedSyncKeys.clear();
}
