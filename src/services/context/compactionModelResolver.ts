// ---------------------------------------------------------------------------
// Kavi — Compaction model resolver
// ---------------------------------------------------------------------------
// Tier-2/tier-3 compaction summaries are model-authored by default: a mechanical
// extraction of the last few tool previews loses exactly the task state a long
// run needs. The active provider is used unless Settings names a cheaper one.
// Users can force the deterministic path, and on-device runtimes always use it
// because a second local inference pass would stall the turn.
// ---------------------------------------------------------------------------

import { useSettingsStore } from '../../store/useSettingsStore';
import type { LlmProviderConfig } from '../../types/provider';
import { resolveProviderApiKey } from '../llm/support/providerSupport';
import { isOnDeviceLlmProvider } from '../localLlm/provider';

export interface CompactionSummarizerConfig {
  provider: LlmProviderConfig;
  model: string;
  apiKey: string | null;
}

export interface ResolveCompactionSummarizerOptions {
  /** Model used by the turn being compacted; preferred when no override is set. */
  requestModel?: string;
  /** True when the turn runs on-device; forces the deterministic summarizer. */
  onDeviceProvider?: boolean;
}

function findEnabledProvider(
  providers: ReadonlyArray<LlmProviderConfig>,
  providerId: string,
): LlmProviderConfig | null {
  const trimmed = providerId.trim();
  if (!trimmed) {
    return null;
  }
  return providers.find((provider) => provider.id === trimmed && provider.enabled) ?? null;
}

function buildConfig(
  provider: LlmProviderConfig,
  model: string,
  apiKey: string | null,
): CompactionSummarizerConfig | null {
  return model ? { provider, model, apiKey } : null;
}

export async function resolveCompactionSummarizerConfig(
  options?: ResolveCompactionSummarizerOptions,
): Promise<CompactionSummarizerConfig | null> {
  const settings = useSettingsStore.getState();
  if (settings.compactionSummarizer === 'off' || options?.onDeviceProvider === true) {
    return null;
  }

  const overrideProviderId = (settings.compactionProvider ?? '').trim();
  if (overrideProviderId) {
    const provider = findEnabledProvider(settings.providers, overrideProviderId);
    if (provider && !isOnDeviceLlmProvider(provider)) {
      const model = (settings.compactionModel ?? '').trim() || provider.model;
      const apiKey = await resolveProviderApiKey(provider);
      return buildConfig(provider, model, apiKey ?? null);
    }
    // An override that no longer resolves falls through to the active provider
    // rather than silently dropping to the deterministic summarizer.
  }

  const activeProvider = settings.activeProviderId
    ? findEnabledProvider(settings.providers, settings.activeProviderId)
    : null;
  if (!activeProvider || isOnDeviceLlmProvider(activeProvider)) {
    return null;
  }

  const model = (options?.requestModel ?? '').trim() || activeProvider.model;
  const apiKey = await resolveProviderApiKey(activeProvider);
  return buildConfig(activeProvider, model, apiKey ?? null);
}
