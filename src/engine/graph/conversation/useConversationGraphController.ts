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
  EnsureCanonicalConversationOptions,
} from '../foregroundRun/executionTypes';
import type { ResolvedFinalizationProviderContext } from '../foregroundRun/contracts';
import {
  resolveConversationModeForPersona,
  resolveConversationPersonaForMode,
} from './modeTransitions';

type ChatStoreState = ReturnType<typeof useChatStore.getState>;
type SettingsStoreState = ReturnType<typeof useSettingsStore.getState>;

type ResolveConversationFinalizationContext = (
  conversation: Conversation,
) => Promise<ResolvedFinalizationProviderContext | undefined>;

type UseConversationGraphControllerParams = {
  activeConversationId: string | null;
  activeModel: string | null;
  activeProviderId: string | null;
  effectiveMode: Conversation['mode'];
  effectivePersonaId: string;
  getOrCreateCanonicalThread: ChatStoreState['getOrCreateCanonicalThread'];
  noProviderMessage: string;
  providers: SettingsStoreState['providers'];
  setActiveProviderAndModel: SettingsStoreState['setActiveProviderAndModel'];
  setChatError: (message: string | null) => void;
  setLastUsedModel: SettingsStoreState['setLastUsedModel'];
  systemPrompt: string;
  updateModeInConversation: ChatStoreState['updateModeInConversation'];
  updateModelInConversation: ChatStoreState['updateModelInConversation'];
  updatePersonaInConversation: ChatStoreState['updatePersonaInConversation'];
};

export function useConversationGraphController(params: UseConversationGraphControllerParams): {
  ensureCanonicalConversation: ForegroundConversationRunHelpers['ensureCanonicalConversation'];
  handleModelSelect: (providerId: string, model: string) => void;
  handlePersonaSelect: (personaId: string) => void;
  handleToggleMode: () => void;
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

  const ensureCanonicalConversation = useCallback(
    (options?: EnsureCanonicalConversationOptions) => {
      const selection = resolveConversationStartDefaults();
      const providerId = options?.providerId ?? selection?.providerId;
      if (!providerId) {
        if (options?.reportMissingProvider) {
          params.setChatError(params.noProviderMessage);
        }
        return null;
      }

      const model = options?.model ?? selection?.model ?? undefined;
      return params.getOrCreateCanonicalThread(providerId, params.systemPrompt, model, {
        activate: options?.activate,
        personaId: options?.personaId,
        mode: options?.mode,
      });
    },
    [params, resolveConversationStartDefaults],
  );

  useEffect(() => {
    if (params.activeConversationId) {
      return;
    }

    ensureCanonicalConversation({
      personaId: params.effectivePersonaId,
      mode: params.effectiveMode,
      reportMissingProvider: false,
    });
  }, [
    ensureCanonicalConversation,
    params.activeConversationId,
    params.effectiveMode,
    params.effectivePersonaId,
  ]);

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
      const nextMode = resolveConversationModeForPersona(personaId);
      let conversationId = params.activeConversationId;
      if (!conversationId) {
        conversationId = ensureCanonicalConversation({
          personaId,
          mode: nextMode,
          reportMissingProvider: true,
        });
        if (!conversationId) {
          return;
        }
      }

      params.updatePersonaInConversation(conversationId, personaId);
      params.updateModeInConversation(conversationId, nextMode);
    },
    [ensureCanonicalConversation, params],
  );

  const handleToggleMode = useCallback(() => {
    const nextMode = params.effectiveMode === 'agentic' ? 'chitchat' : 'agentic';
    let conversationId = params.activeConversationId;
    if (!conversationId) {
      conversationId = ensureCanonicalConversation({
        personaId: resolveConversationPersonaForMode({ nextMode }),
        mode: nextMode,
        reportMissingProvider: true,
      });
      if (!conversationId) {
        return;
      }
    }

    const currentConversation = useChatStore
      .getState()
      .conversations.find((candidate) => candidate.id === conversationId);
    const nextPersonaId = resolveConversationPersonaForMode({
      conversationPersonaId: currentConversation?.personaId,
      nextMode,
    });

    params.updateModeInConversation(conversationId, nextMode);
    params.updatePersonaInConversation(conversationId, nextPersonaId);
  }, [ensureCanonicalConversation, params]);

  return {
    ensureCanonicalConversation,
    handleModelSelect,
    handlePersonaSelect,
    handleToggleMode,
    resolveConversationFinalizationContext,
    resolveConversationFinalizationContextRef,
  };
}
