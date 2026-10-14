import { useCallback, useEffect } from 'react';
import { useChatStore } from '../../../store/useChatStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { resolveConversationStartSelection } from '../../../services/llm/support/providerSupport';
import type {
  ForegroundConversationRunHelpers,
  EnsureConversationOptions,
} from '../foregroundRun/executionTypes';

type ChatStoreState = ReturnType<typeof useChatStore.getState>;
type SettingsStoreState = ReturnType<typeof useSettingsStore.getState>;

type UseConversationGraphControllerParams = {
  activeConversationId: string | null;
  activeModel: string | null;
  activeProviderId: string | null;
  ensureStoredConversation: ChatStoreState['ensureConversation'];
  noProviderMessage: string;
  providers: SettingsStoreState['providers'];
  setActiveProviderAndModel: SettingsStoreState['setActiveProviderAndModel'];
  setChatError: (message: string | null) => void;
  setLastUsedModel: SettingsStoreState['setLastUsedModel'];
  systemPrompt: string;
  updateModelInConversation: ChatStoreState['updateModelInConversation'];
  updatePersonaInConversation: ChatStoreState['updatePersonaInConversation'];
};

export function useConversationGraphController(params: UseConversationGraphControllerParams): {
  ensureConversation: ForegroundConversationRunHelpers['ensureConversation'];
  handleModelSelect: (providerId: string, model: string) => void;
  handlePersonaSelect: (personaId: string) => void;
} {
  const resolveConversationStartDefaults = useCallback(
    () =>
      resolveConversationStartSelection(
        params.providers,
        params.activeProviderId,
        params.activeModel,
      ),
    [params.activeModel, params.activeProviderId, params.providers],
  );

  const ensureConversation = useCallback(
    (options?: EnsureConversationOptions) => {
      const selection = resolveConversationStartDefaults();
      const providerId = options?.providerId ?? selection?.providerId;
      if (!providerId) {
        if (options?.reportMissingProvider) {
          params.setChatError(params.noProviderMessage);
        }
        return null;
      }

      const model = options?.model ?? selection?.model ?? undefined;
      return params.ensureStoredConversation(providerId, params.systemPrompt, model);
    },
    [params, resolveConversationStartDefaults],
  );

  useEffect(() => {
    if (params.activeConversationId) {
      return;
    }

    ensureConversation({ reportMissingProvider: false });
  }, [ensureConversation, params.activeConversationId]);

  const handleModelSelect = useCallback(
    (providerId: string, model: string) => {
      params.setActiveProviderAndModel(providerId, model);
      if (params.activeConversationId) {
        params.updateModelInConversation(params.activeConversationId, providerId, model);
      }
      params.setLastUsedModel(providerId, model);
    },
    [params],
  );

  const handlePersonaSelect = useCallback(
    (personaId: string) => {
      const conversationId =
        params.activeConversationId ?? ensureConversation({ reportMissingProvider: true });
      if (conversationId) params.updatePersonaInConversation(conversationId, personaId);
    },
    [ensureConversation, params],
  );

  return {
    ensureConversation,
    handleModelSelect,
    handlePersonaSelect,
  };
}
