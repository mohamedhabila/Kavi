// ---------------------------------------------------------------------------
// Kavi — Embedding provider selection
// ---------------------------------------------------------------------------
// Structural provider resolution for the provider-backed semantic memory lane
// (no language heuristics — this only inspects settings, never message
// content). Mirrors the enrichment-provider cascade in
// `consolidation/paths.ts`, but selects an *embedding-capable* provider
// rather than a chat-completion one, and is gated the same way the existing
// consolidation-provider setting and `disableLongTermMemory` flag already
// gate provider calls:
//   • `disableLongTermMemory` → no provider embeddings at all (offline).
//   • memory consolidation enrichment mode `off` → no provider embeddings.
// No dedicated embedding settings field is introduced.
//
// OpenAI and Gemini share the same API key already configured for chat, so
// an enabled provider of either family is enough to opt in. Voyage, Mistral,
// and Ollama are embedding-only/optional providers — they are only selected
// when their own credentials (Voyage/Mistral) or host (Ollama) are actually
// configured, so a bare disabled/placeholder entry never gets selected.
// ---------------------------------------------------------------------------

import { useSettingsStore } from '../../store/useSettingsStore';
import type { LlmProviderConfig, LlmProviderFamily } from '../../types/provider';
import type { EmbeddingConfig, EmbeddingProvider } from '../../types/memory';
import { resolveProviderApiKey } from '../llm/support/providerSupport';
import {
  deriveMemoryConsolidationModeFromSettings,
  isMemoryConsolidationEnrichmentEnabled,
} from './memoryConsolidationMode';

export interface ResolvedEmbeddingProviderPath {
  /** The settings provider entry this embedding config was derived from. */
  providerId: string;
  providerFamily: LlmProviderFamily;
  config: EmbeddingConfig;
}

interface EmbeddingFamilyPlan {
  family: LlmProviderFamily;
  provider: EmbeddingProvider;
  defaultModel: string;
  defaultDimensions: number;
  /** Reuse the provider's own configured base URL (self-hosted/proxy/Vertex). */
  forwardBaseUrl: boolean;
  /**
   * Require a resolved, non-empty API key before this family can be
   * selected — an enabled entry with no working credential is skipped
   * rather than selected-and-later-failing at call time.
   */
  requiresApiKey: boolean;
}

// Priority order: providers that already share a chat API key first, then
// embedding-capable providers that require their own explicit setup.
const EMBEDDING_FAMILY_PLANS: ReadonlyArray<EmbeddingFamilyPlan> = [
  {
    family: 'openai',
    provider: 'openai',
    defaultModel: 'text-embedding-3-small',
    defaultDimensions: 1536,
    forwardBaseUrl: true,
    requiresApiKey: true,
  },
  {
    family: 'gemini',
    provider: 'gemini',
    defaultModel: 'text-embedding-004',
    defaultDimensions: 768,
    forwardBaseUrl: true,
    requiresApiKey: true,
  },
  {
    family: 'voyage',
    provider: 'voyage',
    defaultModel: 'voyage-3-lite',
    defaultDimensions: 512,
    forwardBaseUrl: false,
    requiresApiKey: true,
  },
  {
    family: 'mistral',
    provider: 'mistral',
    defaultModel: 'mistral-embed',
    defaultDimensions: 1024,
    forwardBaseUrl: false,
    requiresApiKey: true,
  },
  {
    family: 'ollama',
    provider: 'ollama',
    defaultModel: 'nomic-embed-text',
    defaultDimensions: 768,
    forwardBaseUrl: true,
    // Ollama is typically keyless; an enabled entry already implies the user
    // pointed it at their own host.
    requiresApiKey: false,
  },
];

function findEnabledProviderForFamily(
  providers: ReadonlyArray<LlmProviderConfig>,
  family: LlmProviderFamily,
): LlmProviderConfig | null {
  return providers.find((provider) => provider.enabled && provider.providerFamily === family) ?? null;
}

/**
 * Resolve which embedding provider (if any) should back the semantic memory
 * lane right now. Returns `null` when embeddings are disabled/gated or no
 * compatible provider is configured — callers must treat `null` as "stay on
 * the on-device fallback", never as an error.
 */
export async function resolveEmbeddingProviderPath(): Promise<ResolvedEmbeddingProviderPath | null> {
  const settings = useSettingsStore.getState();
  if (settings.disableLongTermMemory) return null;

  const mode = deriveMemoryConsolidationModeFromSettings(settings);
  if (!isMemoryConsolidationEnrichmentEnabled(mode)) return null;

  for (const plan of EMBEDDING_FAMILY_PLANS) {
    const provider = findEnabledProviderForFamily(settings.providers, plan.family);
    if (!provider) continue;

    const apiKey = await resolveProviderApiKey(provider);
    if (plan.requiresApiKey && !apiKey.trim()) continue;

    return {
      providerId: provider.id,
      providerFamily: plan.family,
      config: {
        provider: plan.provider,
        model: plan.defaultModel,
        dimensions: plan.defaultDimensions,
        ...(apiKey.trim() ? { apiKey } : {}),
        ...(plan.forwardBaseUrl && provider.baseUrl?.trim()
          ? { baseUrl: provider.baseUrl.trim() }
          : {}),
      },
    };
  }

  return null;
}
