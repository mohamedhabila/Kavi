import { useSettingsStore } from '../../store/useSettingsStore';
import type { LlmProviderConfig } from '../../types/provider';
import {
  bindProviderToModel,
  hydrateProviderForRequest,
  providerRequiresApiKey,
  resolveConversationModel,
  resolveEnabledProvider,
} from '../../services/llm/support/providerSupport';

export interface ToolProviderContextInput {
  provider?: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  model?: string;
}

export interface ResolvedToolProviderContext {
  provider: LlmProviderConfig | null;
  allProviders: LlmProviderConfig[];
  model: string;
}

function selectEnabledProviders(input?: ToolProviderContextInput): LlmProviderConfig[] {
  if (Array.isArray(input?.allProviders) && input.allProviders.length > 0) {
    return input.allProviders.filter((provider) => provider.enabled);
  }

  return useSettingsStore.getState().providers.filter((provider) => provider.enabled);
}

function mergeResolvedProviderIntoCatalog(
  allProviders: LlmProviderConfig[],
  provider: LlmProviderConfig | null,
): LlmProviderConfig[] {
  if (!provider) {
    return allProviders;
  }

  let replaced = false;
  const mergedProviders = allProviders.map((entry) => {
    if (entry.id !== provider.id) {
      return entry;
    }

    replaced = true;
    return {
      ...entry,
      ...provider,
    };
  });

  return replaced ? mergedProviders : [...mergedProviders, provider];
}

async function hydrateSelectableProvider(
  provider: LlmProviderConfig | null | undefined,
): Promise<LlmProviderConfig | null> {
  if (!provider) {
    return null;
  }

  const hydrated = await hydrateProviderForRequest(provider);
  if (providerRequiresApiKey(provider) && !hydrated.apiKey) {
    return null;
  }

  return hydrated;
}

function resolveProviderModel(
  provider: LlmProviderConfig | null | undefined,
  input?: ToolProviderContextInput,
): string {
  if (!provider) {
    return '';
  }

  const settings = useSettingsStore.getState();
  const explicitProviderSelected = input?.provider?.id === provider.id;
  const explicitProviderModel = explicitProviderSelected ? input?.provider?.model : undefined;
  const explicitModel = input?.model ?? explicitProviderModel;
  return resolveConversationModel(provider, {
    conversationModel: explicitModel,
    activeProviderId: explicitProviderSelected ? undefined : settings.activeProviderId,
    activeModel: explicitProviderSelected ? undefined : settings.activeModel,
  });
}

export async function resolveToolProviderContext(
  input?: ToolProviderContextInput,
): Promise<ResolvedToolProviderContext> {
  const allProviders = selectEnabledProviders(input);
  const settings = useSettingsStore.getState();
  const providerTemplate =
    input?.provider ?? resolveEnabledProvider(allProviders, settings.activeProviderId) ?? null;
  const model = resolveProviderModel(providerTemplate, input);
  const hydratedProvider = await hydrateSelectableProvider(providerTemplate);
  const provider = hydratedProvider ? bindProviderToModel(hydratedProvider, model) : null;

  return {
    provider,
    allProviders: mergeResolvedProviderIntoCatalog(allProviders, provider),
    model,
  };
}
