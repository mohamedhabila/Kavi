import type { StoreApi } from 'zustand';
import { generateId } from '../utils/id';
import { getDefaultConversationTitle } from '../utils/conversation';
import { requestChatStorePersistenceCheckpoint } from './chatStorePersistence';
import { resolveConversationWorkspaceTargetId } from './chatStoreHelpers';
import type { ChatState } from './chatStoreTypes';

type ChatStoreSet = StoreApi<ChatState>['setState'];
type ChatStoreGet = StoreApi<ChatState>['getState'];

function buildEmptyConversationUsage() {
  return {
    entries: [],
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
    totalTokens: 0,
    totalCost: 0,
    totalCalls: 0,
  };
}

export function createConversationStoreActions(
  set: ChatStoreSet,
  get: ChatStoreGet,
): Pick<
  ChatState,
  | 'createConversation'
  | 'getOrCreateCanonicalThread'
  | 'createSideThread'
  | 'discardSideThread'
  | 'setActiveConversation'
  | 'deleteConversation'
  | 'clearAllConversations'
  | 'updateModelInConversation'
  | 'updatePersonaInConversation'
  | 'updateModeInConversation'
> {
  return {
    createConversation: (providerId, systemPrompt, modelOverride, options) => {
      const now = Date.now();
      const id = generateId();
      const workspaceTargetId = resolveConversationWorkspaceTargetId();
      const newConversation = {
        id,
        title: getDefaultConversationTitle(),
        messages: [],
        providerId,
        modelOverride,
        systemPrompt,
        createdAt: now,
        updatedAt: now,
        personaId: options?.personaId,
        mode: options?.mode,
        usage: buildEmptyConversationUsage(),
        logs: [],
        agentRuns: [],
        ...(workspaceTargetId ? { workspaceTargetId } : {}),
      };
      set((state) => ({
        conversations: [newConversation, ...state.conversations],
        activeConversationId: options?.activate === false ? state.activeConversationId : id,
      }));
      requestChatStorePersistenceCheckpoint();
      return id;
    },

    getOrCreateCanonicalThread: (providerId, systemPrompt, modelOverride, options) => {
      const groupKey =
        options?.personaId && options.personaId.length > 0 ? options.personaId : '__default__';
      const { conversations } = get();
      const existingCandidates = conversations.filter((c) => {
        if (c.isSideThread || c.archivedFromMigration) return false;
        if (!c.isCanonical) return false;
        const ownKey = c.personaId && c.personaId.length > 0 ? c.personaId : '__default__';
        return ownKey === groupKey;
      });
      const existing =
        existingCandidates.length > 0
          ? existingCandidates.reduce((best, c) => (c.updatedAt > best.updatedAt ? c : best))
          : undefined;
      if (existing) {
        if (options?.activate !== false) {
          set({ activeConversationId: existing.id });
          requestChatStorePersistenceCheckpoint();
        }
        return existing.id;
      }
      const now = Date.now();
      const id = generateId();
      const workspaceTargetId = resolveConversationWorkspaceTargetId();
      const newConversation = {
        id,
        title: getDefaultConversationTitle(),
        messages: [],
        providerId,
        modelOverride,
        systemPrompt,
        createdAt: now,
        updatedAt: now,
        personaId: options?.personaId,
        mode: options?.mode,
        isCanonical: true,
        usage: buildEmptyConversationUsage(),
        logs: [],
        agentRuns: [],
        ...(workspaceTargetId ? { workspaceTargetId } : {}),
      };
      set((state) => ({
        conversations: [newConversation, ...state.conversations],
        activeConversationId: options?.activate === false ? state.activeConversationId : id,
      }));
      requestChatStorePersistenceCheckpoint();
      return id;
    },

    createSideThread: (parentConversationId, options) => {
      const { conversations } = get();
      const parent = conversations.find((c) => c.id === parentConversationId);
      if (!parent) return null;
      if (parent.isSideThread) return null;

      const now = Date.now();
      const id = generateId();
      const workspaceTargetId = resolveConversationWorkspaceTargetId(parent.workspaceTargetId);
      const sideThread = {
        id,
        title: options?.title ?? `↳ ${parent.title}`,
        messages: [],
        providerId: options?.providerId ?? parent.providerId,
        modelOverride: options?.modelOverride ?? parent.modelOverride,
        systemPrompt: options?.systemPrompt ?? parent.systemPrompt,
        createdAt: now,
        updatedAt: now,
        personaId: options?.personaId ?? parent.personaId,
        mode: options?.mode ?? parent.mode,
        parentConversationId,
        isSideThread: true,
        usage: buildEmptyConversationUsage(),
        logs: [],
        agentRuns: [],
        ...(workspaceTargetId ? { workspaceTargetId } : {}),
      };
      set((state) => ({
        conversations: [sideThread, ...state.conversations],
        activeConversationId: options?.activate === false ? state.activeConversationId : id,
      }));
      requestChatStorePersistenceCheckpoint();
      return id;
    },

    discardSideThread: (id) => {
      const { conversations } = get();
      const target = conversations.find((c) => c.id === id);
      if (!target || !target.isSideThread) return false;
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== id),
        activeConversationId:
          state.activeConversationId === id
            ? (target.parentConversationId ?? null)
            : state.activeConversationId,
      }));
      requestChatStorePersistenceCheckpoint();
      return true;
    },

    setActiveConversation: (id) => {
      set({ activeConversationId: id });
      requestChatStorePersistenceCheckpoint();
    },

    deleteConversation: (id) => {
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== id),
        activeConversationId:
          state.activeConversationId === id ? null : state.activeConversationId,
      }));
      requestChatStorePersistenceCheckpoint();
    },

    clearAllConversations: () => {
      set({ conversations: [], activeConversationId: null });
      requestChatStorePersistenceCheckpoint();
    },

    updateModelInConversation: (conversationId, providerId, model) =>
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === conversationId ? { ...c, providerId, modelOverride: model } : c,
        ),
      })),

    updatePersonaInConversation: (conversationId, personaId) => {
      set((state) => ({
        conversations: state.conversations.map((c) => {
          if (c.id !== conversationId) return c;
          const previousPersonaId = c.personaId;
          const shouldRecordEvent = previousPersonaId !== personaId && c.messages.length > 0;
          const personaEvents = shouldRecordEvent
            ? [
                ...(c.personaEvents ?? []),
                {
                  id: generateId(),
                  at: Date.now(),
                  from: previousPersonaId,
                  to: personaId,
                },
              ]
            : c.personaEvents;
          return { ...c, personaId, personaEvents };
        }),
      }));
      requestChatStorePersistenceCheckpoint();
    },

    updateModeInConversation: (conversationId, mode) =>
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === conversationId ? { ...c, mode } : c,
        ),
      })),
  };
}
