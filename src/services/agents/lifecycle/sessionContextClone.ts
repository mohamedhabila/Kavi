import type { LlmProviderConfig } from '../../../types/provider';
import type { SubAgentConfig } from '../../../types/subAgent';
import { cloneStoredMessages } from './sessionContextMessages';
import type { SubAgentSessionContext } from './sessionContext';

type CloneSubAgentConfig = (config: SubAgentConfig) => SubAgentConfig;

export function cloneProviderConfig(provider: LlmProviderConfig): LlmProviderConfig {
  return {
    ...provider,
    ...(provider.availableModels ? { availableModels: [...provider.availableModels] } : {}),
    ...(provider.hiddenModels ? { hiddenModels: [...provider.hiddenModels] } : {}),
    ...(provider.modelCapabilities ? { modelCapabilities: { ...provider.modelCapabilities } } : {}),
  };
}

function cloneProviderConfigForSessionPersistence(provider: LlmProviderConfig): LlmProviderConfig {
  return {
    ...cloneProviderConfig(provider),
    apiKey: '',
  };
}

export function cloneSessionContext(
  context: SubAgentSessionContext,
  cloneConfig: CloneSubAgentConfig,
  options?: { redactProviderSecrets?: boolean },
): SubAgentSessionContext {
  if (!Array.isArray(context.messages)) {
    throw new Error('Malformed stored session context messages');
  }

  const cloneProvider = options?.redactProviderSecrets
    ? cloneProviderConfigForSessionPersistence
    : cloneProviderConfig;

  return {
    config: cloneConfig(context.config),
    provider: cloneProvider(context.provider),
    ...(context.allProviders
      ? { allProviders: context.allProviders.map((entry) => cloneProvider(entry)) }
      : {}),
    systemPrompt: context.systemPrompt,
    conversationSummary: context.conversationSummary,
    messages: cloneStoredMessages(context.messages),
  };
}
