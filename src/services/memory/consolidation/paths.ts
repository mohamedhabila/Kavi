// ---------------------------------------------------------------------------
// Kavi — Consolidation provider cascade
// ---------------------------------------------------------------------------
// Structural provider resolution for memory enrichment (no language heuristics):
//   1. Explicit consolidation provider from Settings
//   2. Enabled on-device LLM provider
//   3. Active chat provider
//   4. Deterministic structural extractor only (extractor = null)
// ---------------------------------------------------------------------------

import { useSettingsStore } from '../../../store/useSettingsStore';
import type { LlmProviderConfig } from '../../../types/provider';
import {
  deriveMemoryConsolidationModeFromSettings,
  isMemoryConsolidationEnrichmentEnabled,
} from '../memoryConsolidationMode';
import { isE2EAgentEvalRuntime } from '../../../engine/tools/e2eNativeCalendarFixtures';
import { createTimeoutSignal } from '../../../utils/runtime';
import { LlmService } from '../../llm/LlmService';
import { isOnDeviceLlmProvider } from '../../localLlm/provider';
import { resolveConversationModel, resolveProviderApiKey } from '../../llm/support/providerSupport';
import { UnsupportedConsolidatorResponseError, type ConsolidatorExtractor } from '../consolidator';

const MEMORY_EXTRACTOR_TIMEOUT_MS = 30_000;
const MEMORY_EXTRACTOR_MAX_TOKENS = 32_000;

export type ConsolidationProviderTier = 'configured' | 'on_device' | 'chat' | 'deterministic';

export interface ResolvedConsolidationPath {
  tier: ConsolidationProviderTier;
  provider: LlmProviderConfig | null;
  model: string | null;
  extractor: ConsolidatorExtractor | null;
}

export function extractConsolidationAssistantText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (!response || typeof response !== 'object') {
    throw new UnsupportedConsolidatorResponseError();
  }
  const value = response as Record<string, unknown>;
  const choiceContent = (
    value.choices as Array<{ message?: { content?: unknown } }> | undefined
  )?.[0]?.message?.content;
  if (typeof choiceContent === 'string') return choiceContent;
  if (Array.isArray(choiceContent)) {
    const parts = choiceContent.map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') throw new UnsupportedConsolidatorResponseError();
      const textPart = part as Record<string, unknown>;
      if (typeof textPart.text === 'string') return textPart.text;
      if (typeof textPart.output_text === 'string') return textPart.output_text;
      throw new UnsupportedConsolidatorResponseError();
    });
    return parts.join('');
  }
  if (typeof value.output_text === 'string') return value.output_text;
  throw new UnsupportedConsolidatorResponseError();
}

function buildProviderExtractor(
  provider: LlmProviderConfig,
  apiKey: string | null,
  model: string,
): ConsolidatorExtractor {
  const llm = new LlmService(apiKey ? { ...provider, apiKey } : provider);
  return async (prompt: string) => {
    const response = await llm.sendMessage([{ role: 'user', content: prompt }] as never, {
      model,
      maxTokens: MEMORY_EXTRACTOR_MAX_TOKENS,
      signal: createTimeoutSignal(MEMORY_EXTRACTOR_TIMEOUT_MS),
    });
    return extractConsolidationAssistantText(response);
  };
}

function findEnabledProvider(
  providers: ReadonlyArray<LlmProviderConfig>,
  providerId: string,
): LlmProviderConfig | null {
  const trimmed = providerId.trim();
  if (!trimmed) return null;
  return providers.find((provider) => provider.id === trimmed && provider.enabled) ?? null;
}

function findFirstOnDeviceProvider(
  providers: ReadonlyArray<LlmProviderConfig>,
): LlmProviderConfig | null {
  return providers.find((provider) => provider.enabled && isOnDeviceLlmProvider(provider)) ?? null;
}

async function resolveProviderPath(
  provider: LlmProviderConfig,
  tier: ConsolidationProviderTier,
): Promise<ResolvedConsolidationPath> {
  const settings = useSettingsStore.getState();
  const model = resolveConversationModel(provider, {
    activeProviderId: settings.activeProviderId,
    activeModel: settings.activeModel,
  });
  if (!model) {
    return { tier: 'deterministic', provider: null, model: null, extractor: null };
  }
  const apiKey = await resolveProviderApiKey(provider);
  return {
    tier,
    provider,
    model,
    extractor: buildProviderExtractor(provider, apiKey ?? null, model),
  };
}

function resolveDeterministicPath(): ResolvedConsolidationPath {
  return { tier: 'deterministic', provider: null, model: null, extractor: null };
}

export async function resolveConsolidationPath(
  activeChatProvider?: LlmProviderConfig,
): Promise<ResolvedConsolidationPath> {
  if (isE2EAgentEvalRuntime() && !activeChatProvider) {
    return resolveDeterministicPath();
  }

  const settings = useSettingsStore.getState();
  if (settings.disableLongTermMemory) {
    return resolveDeterministicPath();
  }

  const mode = deriveMemoryConsolidationModeFromSettings(settings);
  if (!isMemoryConsolidationEnrichmentEnabled(mode)) {
    return resolveDeterministicPath();
  }

  if (mode === 'specific') {
    const configured = findEnabledProvider(
      settings.providers,
      settings.consolidationProvider ?? '',
    );
    if (configured) {
      return resolveProviderPath(configured, 'configured');
    }
    return resolveDeterministicPath();
  }

  if (mode === 'local') {
    const onDevice = findFirstOnDeviceProvider(settings.providers);
    if (onDevice) {
      return resolveProviderPath(onDevice, 'on_device');
    }
    return resolveDeterministicPath();
  }

  if (mode === 'active_provider') {
    const chatProvider =
      activeChatProvider ??
      findEnabledProvider(settings.providers, settings.activeProviderId ?? '');
    if (chatProvider) {
      return resolveProviderPath(chatProvider, 'chat');
    }
    return resolveDeterministicPath();
  }

  const configuredId = (settings.consolidationProvider ?? '').trim();
  const configured = findEnabledProvider(settings.providers, configuredId);
  if (configured) {
    return resolveProviderPath(configured, 'configured');
  }

  const onDevice = findFirstOnDeviceProvider(settings.providers);
  if (onDevice) {
    return resolveProviderPath(onDevice, 'on_device');
  }

  const chatProvider =
    activeChatProvider ?? findEnabledProvider(settings.providers, settings.activeProviderId ?? '');
  if (chatProvider) {
    return resolveProviderPath(chatProvider, 'chat');
  }

  return resolveDeterministicPath();
}
