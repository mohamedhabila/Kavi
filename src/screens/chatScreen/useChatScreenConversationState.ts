import { useMemo } from 'react';
import { SUPER_AGENT_PERSONA_ID } from '../../services/agents/personas';
import { resolveConversationModel } from '../../services/llm/support/providerSupport';
import type { Conversation } from '../../types/conversation';
import type { LlmProviderConfig } from '../../types/provider';

type UseChatScreenConversationStateParams = {
  activeConversation?: Conversation;
  activeModel: string | null;
  activeProviderId: string | null;
  defaultConversationMode: Conversation['mode'];
  foregroundRequestConversationId: string | null;
  providers: LlmProviderConfig[];
};

type ChatScreenConversationState = {
  activeProvider?: LlmProviderConfig;
  currentModel: string | null;
  effectiveMode: Conversation['mode'];
  effectivePersonaId: string;
  isAgenticMode: boolean;
  isConversationBusy: boolean;
  supportsVision: boolean;
};

export function useChatScreenConversationState(
  params: UseChatScreenConversationStateParams,
): ChatScreenConversationState {
  const activeProvider = useMemo(
    () =>
      params.providers.find(
        (provider) =>
          provider.id === (params.activeConversation?.providerId || params.activeProviderId),
      ),
    [params.activeConversation?.providerId, params.activeProviderId, params.providers],
  );

  const currentModel = resolveConversationModel(activeProvider, {
    conversationModel: params.activeConversation?.modelOverride,
    activeProviderId: params.activeProviderId,
    activeModel: params.activeModel,
  });

  const effectiveMode =
    params.activeConversation?.mode ?? params.defaultConversationMode ?? 'agentic';
  const isAgenticMode = effectiveMode === 'agentic';
  const activeConversationHasRunningRun = (params.activeConversation?.agentRuns ?? []).some(
    (run) => run.status === 'running',
  );
  const isConversationBusy =
    (params.activeConversation?.id != null &&
      params.foregroundRequestConversationId === params.activeConversation.id) ||
    activeConversationHasRunningRun;
  const effectivePersonaId = isAgenticMode
    ? SUPER_AGENT_PERSONA_ID
    : params.activeConversation?.personaId || 'default';
  const supportsVision = activeProvider?.modelCapabilities?.[currentModel]?.vision ?? false;

  return {
    activeProvider,
    currentModel,
    effectiveMode,
    effectivePersonaId,
    isAgenticMode,
    isConversationBusy,
    supportsVision,
  };
}
