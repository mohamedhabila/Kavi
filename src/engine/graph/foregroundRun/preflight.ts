import type { Conversation } from '../../../types/conversation';
import type { LlmProviderConfig } from '../../../types/provider';
import {
  bindProviderToModel,
  providerRequiresApiKey,
  resolveConversationModel,
  resolveEnabledProvider,
  resolveProviderApiKey,
} from '../../../services/llm/support/providerSupport';
import type { ResolvedFinalizationProviderContext, RunChatOptions } from './contracts';

export type ForegroundRunPreflightResult =
  | { kind: 'missing_provider' }
  | { kind: 'missing_api_key' }
  | { kind: 'missing_model' }
  | {
      kind: 'ready';
      provider: LlmProviderConfig;
      providerWithApiKey: LlmProviderConfig;
      model: string;
      finalizationProviderContext: ResolvedFinalizationProviderContext;
    };

export async function resolveForegroundRunPreflight(params: {
  activeModel: string | null | undefined;
  activeProviderId: string | null | undefined;
  conversation: Conversation | undefined;
  conversationId: string;
  options?: RunChatOptions;
  providers: readonly LlmProviderConfig[];
  systemPrompt: string;
}): Promise<ForegroundRunPreflightResult> {
  const provider = resolveEnabledProvider(
    params.providers,
    params.conversation?.providerId || params.activeProviderId,
  );
  if (!provider) {
    return { kind: 'missing_provider' };
  }

  const apiKey = await resolveProviderApiKey(provider);
  if (providerRequiresApiKey(provider) && !apiKey) {
    return { kind: 'missing_api_key' };
  }

  const model = resolveConversationModel(provider, {
    conversationModel: params.conversation?.modelOverride,
    activeProviderId: params.activeProviderId,
    activeModel: params.activeModel,
  });
  if (!model) {
    return { kind: 'missing_model' };
  }

  const providerWithApiKey = bindProviderToModel(
    {
      ...provider,
      apiKey,
    },
    model,
  );
  const resolvedProvider = bindProviderToModel(provider, model);

  return {
    kind: 'ready',
    provider: resolvedProvider,
    providerWithApiKey,
    model,
    finalizationProviderContext: {
      provider: providerWithApiKey,
      model,
      systemPromptText: params.conversation?.systemPrompt || params.systemPrompt,
      conversationId: params.conversationId,
      internalUserMessageCount: params.options?.additionalUserPrompt?.trim() ? 1 : 0,
    },
  };
}
