// ---------------------------------------------------------------------------
// Kavi — Compaction model resolver
// ---------------------------------------------------------------------------
// Optional LLM summarization for tier-2/tier-3 compaction when configured in
// Settings. Falls back to deterministic structural summaries when unset.
// ---------------------------------------------------------------------------

import { useSettingsStore } from '../../store/useSettingsStore';
import type { LlmProviderConfig } from '../../types/provider';
import { resolveProviderApiKey } from '../llm/support/providerSupport';

export interface CompactionSummarizerConfig {
  provider: LlmProviderConfig;
  model: string;
  apiKey: string | null;
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

export async function resolveCompactionSummarizerConfig(): Promise<CompactionSummarizerConfig | null> {
  const settings = useSettingsStore.getState();
  const providerId = (settings.compactionProvider ?? '').trim();
  if (!providerId) {
    return null;
  }

  const provider = findEnabledProvider(settings.providers, providerId);
  if (!provider) {
    return null;
  }

  const modelOverride = (settings.compactionModel ?? '').trim();
  const model = modelOverride || provider.model;
  if (!model) {
    return null;
  }

  const apiKey = await resolveProviderApiKey(provider);
  return {
    provider,
    model,
    apiKey: apiKey ?? null,
  };
}
