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
import { createLogger } from '../../../utils/logger';
import { createTimeoutSignal } from '../../../utils/runtime';
import { LlmService } from '../../llm/LlmService';
import { isOnDeviceLlmProvider } from '../../localLlm/provider';
import { resolveConversationModel, resolveProviderApiKey } from '../../llm/support/providerSupport';
import type { ConsolidatorExtractor } from '../consolidator';

const logger = createLogger('memory.consolidationCascade');
const MEMORY_EXTRACTOR_TIMEOUT_MS = 30_000;

export type ConsolidationProviderTier = 'configured' | 'on_device' | 'chat' | 'deterministic';

export interface ResolvedConsolidationPath {
  tier: ConsolidationProviderTier;
  provider: LlmProviderConfig | null;
  model: string | null;
  extractor: ConsolidatorExtractor | null;
}

function extractAssistantText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (!response || typeof response !== 'object') return '';
  const value = response as Record<string, unknown>;
  const choiceContent = (
    value.choices as Array<{ message?: { content?: unknown } }> | undefined
  )?.[0]?.message?.content;
  if (typeof choiceContent === 'string') return choiceContent;
  if (Array.isArray(choiceContent)) {
    return choiceContent
      .map((part) =>
        typeof part === 'string'
          ? part
          : ((part as { text?: string; output_text?: string })?.text ??
            (part as { output_text?: string })?.output_text ??
            ''),
      )
      .join('');
  }
  if (typeof value.output_text === 'string') return value.output_text;
  return '';
}

function buildProviderExtractor(
  provider: LlmProviderConfig,
  apiKey: string | null,
  model: string,
): ConsolidatorExtractor {
  const llm = new LlmService(apiKey ? { ...provider, apiKey } : provider);
  return async (prompt: string) => {
    try {
      const response = await llm.sendMessage([{ role: 'user', content: prompt }] as never, {
        model,
        maxTokens: 1600,
        signal: createTimeoutSignal(MEMORY_EXTRACTOR_TIMEOUT_MS),
      });
      return extractAssistantText(response);
    } catch (error) {
      logger.devWarn(
        'Memory extractor failed:',
        error instanceof Error ? error.message : String(error),
      );
      return '';
    }
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
