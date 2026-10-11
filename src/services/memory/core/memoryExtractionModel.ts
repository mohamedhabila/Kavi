// ---------------------------------------------------------------------------
// Kavi — Model that runs background memory extraction
// ---------------------------------------------------------------------------
// Users bring their own keys, so extraction runs on a model they configured: the provider
// chosen in memory settings, otherwise the active chat provider. An on-device model runs
// extraction only when the user chose it explicitly ("local"): small on-device models
// extract poorly and the work competes with the chat for the same chip.
// ---------------------------------------------------------------------------

import { useSettingsStore } from '../../../store/useSettingsStore';
import type { LlmProviderConfig } from '../../../types/provider';
import type { StructuredOutputOptions } from '../../llm/support/contracts';
import { LlmService } from '../../llm/LlmService';
import { isOnDeviceLlmProvider } from '../../localLlm/provider';
import { resolveConversationModel, resolveProviderApiKey } from '../../llm/support/providerSupport';
import { resolveHelperReasoningEffort } from '../../llm/support/reasoningEffortResolution';
import { readReplyText } from '../../llm/support/replyText';
import { createTimeoutSignal } from '../../../utils/runtime';
import { deriveMemoryConsolidationModeFromSettings } from '../memoryConsolidationMode';

const MEMORY_EXTRACTION_TIMEOUT_MS = 60_000;
export const MEMORY_EXTRACTION_MAX_OPERATIONS = 8;
const MEMORY_EXTRACTION_MAX_TOKENS = 1_500;

/** Sends one extraction prompt and returns the reply text. Throws on transport failure. */
export type MemoryExtractionCall = (prompt: string, signal: AbortSignal) => Promise<string>;

const MEMORY_EXTRACTION_OUTPUT_SCHEMA: StructuredOutputOptions = {
  name: 'memory_operations',
  mimeType: 'application/json',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['operations'],
    properties: {
      operations: {
        type: 'array',
        maxItems: MEMORY_EXTRACTION_MAX_OPERATIONS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'id', 'text'],
          properties: {
            op: { type: 'string', enum: ['add', 'update', 'delete'] },
            id: { type: ['string', 'null'] },
            text: { type: ['string', 'null'] },
          },
        },
      },
    },
  },
};

function findEnabledProvider(
  providers: ReadonlyArray<LlmProviderConfig>,
  providerId: string | null | undefined,
): LlmProviderConfig | null {
  const id = (providerId ?? '').trim();
  return id ? (providers.find((provider) => provider.id === id && provider.enabled) ?? null) : null;
}

function selectExtractionProvider(): LlmProviderConfig | null {
  const settings = useSettingsStore.getState();
  if (settings.disableLongTermMemory) return null;
  const mode = deriveMemoryConsolidationModeFromSettings(settings);
  switch (mode) {
    case 'off':
      return null;
    case 'local':
      return (
        settings.providers.find(
          (provider) => provider.enabled && isOnDeviceLlmProvider(provider),
        ) ?? null
      );
    case 'specific':
      return findEnabledProvider(settings.providers, settings.consolidationProvider);
    case 'auto':
    case 'active_provider': {
      const provider =
        (mode === 'auto'
          ? findEnabledProvider(settings.providers, settings.consolidationProvider)
          : null) ?? findEnabledProvider(settings.providers, settings.activeProviderId);
      return provider && !isOnDeviceLlmProvider(provider) ? provider : null;
    }
  }
}

/** The extraction call for the current settings, or null when extraction should not run. */
export async function resolveMemoryExtractionModel(): Promise<MemoryExtractionCall | null> {
  const provider = selectExtractionProvider();
  if (!provider) return null;
  const settings = useSettingsStore.getState();
  const model = resolveConversationModel(provider, {
    activeProviderId: settings.activeProviderId,
    activeModel: settings.activeModel,
  });
  if (!model) return null;
  const apiKey = await resolveProviderApiKey(provider);
  const llm = new LlmService(apiKey ? { ...provider, apiKey } : provider);
  const reasoningEffort = resolveHelperReasoningEffort(provider, model);
  return async (prompt, signal) => {
    const timeout = createTimeoutSignal(MEMORY_EXTRACTION_TIMEOUT_MS);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (timeout.aborted || signal.aborted) controller.abort();
    timeout.addEventListener('abort', abort, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    try {
      const response = await llm.sendMessage([{ role: 'user', content: prompt }] as never, {
        model,
        maxTokens: MEMORY_EXTRACTION_MAX_TOKENS,
        temperature: 0,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        structuredOutput: MEMORY_EXTRACTION_OUTPUT_SCHEMA,
        signal: controller.signal,
      });
      return readReplyText(response);
    } finally {
      timeout.removeEventListener('abort', abort);
      signal.removeEventListener('abort', abort);
    }
  };
}
