import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { useChatStore } from '../../../store/useChatStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import type { Conversation } from '../../../types/conversation';
import {
  resolveConversationProviderContext,
  resolveConversationStartSelection,
} from '../../../services/llm/support/providerSupport';
import type {
  ForegroundConversationRunHelpers,
  EnsureConversationOptions,
} from '../foregroundRun/executionTypes';
import type { ResolvedFinalizationProviderContext } from '../foregroundRun/contracts';

type ChatStoreState = ReturnType<typeof useChatStore.getState>;
type SettingsStoreState = ReturnType<typeof useSettingsStore.getState>;

type ResolveConversationFinalizationContext = (
  conversation: Conversation,
) => Promise<ResolvedFinalizationProviderContext | undefined>;

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
  resolveConversationFinalizationContext: ResolveConversationFinalizationContext;
  resolveConversationFinalizationContextRef: MutableRefObject<ResolveConversationFinalizationContext | null>;
} {
  const resolveConversationFinalizationContextRef =
    useRef<ResolveConversationFinalizationContext | null>(null);

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

  const resolveConversationFinalizationContext = useCallback(
    async (conversation: Conversation) => {
      const providerContext = await resolveConversationProviderContext({
        activeModel: params.activeModel,
        activeProviderId: params.activeProviderId,
        conversation,
        providers: params.providers,
        systemPrompt: params.systemPrompt,
      });
      if (!providerContext) {
        return undefined;
      }

      return {
        ...providerContext,
        conversationId: conversation.id,
        personaId: conversation.personaId,
        internalUserMessageCount: 0,
      };
    },
    [params],
  );

  useEffect(() => {
    resolveConversationFinalizationContextRef.current = resolveConversationFinalizationContext;
    return () => {
      if (
        resolveConversationFinalizationContextRef.current === resolveConversationFinalizationContext
      ) {
        resolveConversationFinalizationContextRef.current = null;
      }
    };
  }, [resolveConversationFinalizationContext]);

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
    resolveConversationFinalizationContext,
    resolveConversationFinalizationContextRef,
  };
}
