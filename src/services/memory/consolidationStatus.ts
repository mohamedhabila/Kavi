// ---------------------------------------------------------------------------
// Kavi — Consolidation status (UI snapshot)
// ---------------------------------------------------------------------------
// Synchronous, structural view of which enrichment tier is active. Mirrors
// consolidation/paths without building extractors or network calls.
// ---------------------------------------------------------------------------

import type { LlmProviderConfig } from '../../types/provider';
import { useSettingsStore } from '../../store/useSettingsStore';
import { isOnDeviceLlmProvider } from '../localLlm/provider';
import type { ConsolidationProviderTier } from './consolidation/paths';
import {
  deriveMemoryConsolidationModeFromSettings,
  isMemoryConsolidationEnrichmentEnabled,
  type MemoryConsolidationMode,
} from './memoryConsolidationMode';

export interface ConsolidationStatusSnapshot {
  memoryDisabled: boolean;
  mode: MemoryConsolidationMode;
  tier: ConsolidationProviderTier;
  providerName: string | null;
  explicitProviderSelected: boolean;
  isFallback: boolean;
}

export interface ConsolidationStatusInput {
  disableLongTermMemory: boolean;
  memoryConsolidationMode?: MemoryConsolidationMode;
  consolidationProviderId: string | null;
  activeProviderId: string | null;
  providers: LlmProviderConfig[];
}

function findEnabledProvider(
  providers: LlmProviderConfig[],
  providerId: string,
): LlmProviderConfig | null {
  const trimmed = providerId.trim();
  if (!trimmed) return null;
  return providers.find((provider) => provider.id === trimmed && provider.enabled) ?? null;
}

export function deriveConsolidationStatusSnapshot(
  input: ConsolidationStatusInput,
): ConsolidationStatusSnapshot {
  const mode =
    input.memoryConsolidationMode ??
    deriveMemoryConsolidationModeFromSettings({
      consolidationProvider: input.consolidationProviderId,
    });

  if (input.disableLongTermMemory) {
    return {
      memoryDisabled: true,
      mode,
      tier: 'deterministic',
      providerName: null,
      explicitProviderSelected: false,
      isFallback: false,
    };
  }

  if (!isMemoryConsolidationEnrichmentEnabled(mode)) {
    return {
      memoryDisabled: false,
      mode,
      tier: 'deterministic',
      providerName: null,
      explicitProviderSelected: false,
      isFallback: false,
    };
  }

  if (mode === 'specific') {
    const configured = findEnabledProvider(input.providers, input.consolidationProviderId ?? '');
    if (configured) {
      return {
        memoryDisabled: false,
        mode,
        tier: 'configured',
        providerName: configured.name,
        explicitProviderSelected: true,
        isFallback: false,
      };
    }
    return {
      memoryDisabled: false,
      mode,
      tier: 'deterministic',
      providerName: null,
      explicitProviderSelected: true,
      isFallback: false,
    };
  }

  if (mode === 'local') {
    const onDevice = input.providers.find(
      (provider) => provider.enabled && isOnDeviceLlmProvider(provider),
    );
    if (onDevice) {
      return {
        memoryDisabled: false,
        mode,
        tier: 'on_device',
        providerName: onDevice.name,
        explicitProviderSelected: false,
        isFallback: false,
      };
    }
    return {
      memoryDisabled: false,
      mode,
      tier: 'deterministic',
      providerName: null,
      explicitProviderSelected: false,
      isFallback: false,
    };
  }

  if (mode === 'active_provider') {
    const chatProvider = findEnabledProvider(input.providers, input.activeProviderId ?? '');
    if (chatProvider) {
      return {
        memoryDisabled: false,
        mode,
        tier: 'chat',
        providerName: chatProvider.name,
        explicitProviderSelected: false,
        isFallback: false,
      };
    }
    return {
      memoryDisabled: false,
      mode,
      tier: 'deterministic',
      providerName: null,
      explicitProviderSelected: false,
      isFallback: false,
    };
  }

  const configuredId = (input.consolidationProviderId ?? '').trim();
  const configured = configuredId ? findEnabledProvider(input.providers, configuredId) : null;
  if (configured) {
    return {
      memoryDisabled: false,
      mode,
      tier: 'configured',
      providerName: configured.name,
      explicitProviderSelected: true,
      isFallback: false,
    };
  }

  const onDevice = input.providers.find(
    (provider) => provider.enabled && isOnDeviceLlmProvider(provider),
  );
  if (onDevice) {
    return {
      memoryDisabled: false,
      mode,
      tier: 'on_device',
      providerName: onDevice.name,
      explicitProviderSelected: false,
      isFallback: true,
    };
  }

  const chatProvider = findEnabledProvider(input.providers, input.activeProviderId ?? '');
  if (chatProvider) {
    return {
      memoryDisabled: false,
      mode,
      tier: 'chat',
      providerName: chatProvider.name,
      explicitProviderSelected: false,
      isFallback: true,
    };
  }

  return {
    memoryDisabled: false,
    mode,
    tier: 'deterministic',
    providerName: null,
    explicitProviderSelected: false,
    isFallback: true,
  };
}

export function getConsolidationStatusSnapshot(): ConsolidationStatusSnapshot {
  const settings = useSettingsStore.getState();
  return deriveConsolidationStatusSnapshot({
    disableLongTermMemory: settings.disableLongTermMemory === true,
    memoryConsolidationMode: deriveMemoryConsolidationModeFromSettings(settings),
    consolidationProviderId: settings.consolidationProvider ?? null,
    activeProviderId: settings.activeProviderId ?? null,
    providers: settings.providers,
  });
}
