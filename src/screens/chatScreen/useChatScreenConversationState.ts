import { useMemo } from 'react';
import { resolveConversationModel } from '../../services/llm/support/providerSupport';
import type { Conversation } from '../../types/conversation';
import type { LlmProviderConfig } from '../../types/provider';
import {
  selectActiveConversationExecutionState,
  type ActiveConversationExecutionState,
} from '../../services/agents/activeConversationExecutionState';

type UseChatScreenConversationStateParams = {
  activeConversation?: Conversation;
  activeModel: string | null;
  activeProviderId: string | null;
  hasForegroundRequest: boolean;
  hasActiveRecoveryOperation: boolean;
  hasLiveBackgroundWorker: boolean;
  providers: LlmProviderConfig[];
};

type ChatScreenConversationState = {
  activeProvider?: LlmProviderConfig;
  currentModel: string | null;
  executionState: ActiveConversationExecutionState;
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

  const executionState = useMemo(
    () =>
      selectActiveConversationExecutionState(
        params.activeConversation,
        { hasActiveRequest: params.hasForegroundRequest },
        {
          hasActiveRecoveryOperation: params.hasActiveRecoveryOperation,
          hasLiveBackgroundWorker: params.hasLiveBackgroundWorker,
        },
      ),
    [
      params.activeConversation,
      params.hasActiveRecoveryOperation,
      params.hasForegroundRequest,
      params.hasLiveBackgroundWorker,
    ],
  );
  const isConversationBusy = executionState.isBusy;
  const supportsVision = activeProvider?.modelCapabilities?.[currentModel]?.vision ?? false;

  return {
    activeProvider,
    currentModel,
    executionState,
    isConversationBusy,
    supportsVision,
  };
}
