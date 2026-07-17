import type { StoreApi } from 'zustand';
import { generateId } from '../utils/id';
import { getDefaultConversationTitle } from '../utils/conversation';
import { requestChatStorePersistenceCheckpoint } from './chatStorePersistence';
import { resolveConversationWorkspaceTargetId } from './chatStoreHelpers';
import type { ChatState } from './chatStoreTypes';
import { captureSemanticMemoryHandoff } from '../services/memory/semanticMemoryHandoff';
import { retireConversationSourcesBeforeDeletion } from '../services/memory/conversationDeletionRetirement';
import { resolveConversationWorkspaceTarget } from '../services/conversationWorkspace/ownership';

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

function captureActiveMemoryHandoff(get: ChatStoreGet) {
  const state = get();
  const active = state.activeConversationId
    ? state.conversations.find((conversation) => conversation.id === state.activeConversationId)
    : undefined;
  return captureSemanticMemoryHandoff(active);
}

function retireConversationDeletionTargets(
  get: ChatStoreGet,
  targets: ReadonlyArray<
    Readonly<{
      conversationId: string;
      memoryConversationId: string;
      sourceThreadId: string;
      messages: ChatState['conversations'][number]['messages'];
    }>
  >,
): void {
  const result = retireConversationSourcesBeforeDeletion({ targets });
  for (const withdrawal of result.publicationWithdrawals) {
    const transition = get().transitionMessageMemoryPublication(
      withdrawal.conversationId,
      withdrawal.sourceEndMessageId,
      'withdrawn',
    );
    if (transition.status !== 'applied') {
      throw new Error(`conversation_delete_memory_publication_commit_${transition.reason}`);
    }
  }
}

function attachActivationMemoryHandoff(
  state: Pick<ChatState, 'activeConversationId' | 'conversations'>,
  targetId: string,
) {
  if (!state.activeConversationId || state.activeConversationId === targetId) {
    return state.conversations;
  }
  const target = state.conversations.find((conversation) => conversation.id === targetId);
  if (!target || target.semanticMemoryHandoff || target.modelProjectionOwner) {
    return state.conversations;
  }
  const source = state.conversations.find(
    (conversation) => conversation.id === state.activeConversationId,
  );
  const handoff = captureSemanticMemoryHandoff(source);
  if (!handoff) return state.conversations;
  return state.conversations.map((conversation) =>
    conversation.id === targetId
      ? { ...conversation, semanticMemoryHandoff: handoff }
      : conversation,
  );
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
      const replaceCanonical = options?.replaceCanonical === true;
      const workspaceTargetId = resolveConversationWorkspaceTargetId();
      const semanticMemoryHandoff =
        options?.activate === false ? undefined : captureActiveMemoryHandoff(get);
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
        ...(replaceCanonical ? { isCanonical: true } : {}),
        usage: buildEmptyConversationUsage(),
        logs: [],
        agentRuns: [],
        ...(workspaceTargetId ? { workspaceTargetId } : {}),
        ...(semanticMemoryHandoff ? { semanticMemoryHandoff } : {}),
      };
      set((state) => {
        const personaKey = options?.personaId?.length ? options.personaId : '__default__';
        const existingConversations = replaceCanonical
          ? state.conversations.map((conversation) => {
              const conversationPersonaKey = conversation.personaId?.length
                ? conversation.personaId
                : '__default__';
              if (
                conversation.isSideThread ||
                conversation.archivedFromMigration ||
                !conversation.isCanonical ||
                conversationPersonaKey !== personaKey
              ) {
                return conversation;
              }
              return {
                ...conversation,
                isCanonical: false,
                archivedFromMigration: true,
              };
            })
          : state.conversations;
        return {
          conversations: [newConversation, ...existingConversations],
          activeConversationId: options?.activate === false ? state.activeConversationId : id,
        };
      });
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
          set((state) => ({
            conversations: attachActivationMemoryHandoff(state, existing.id),
            activeConversationId: existing.id,
          }));
          requestChatStorePersistenceCheckpoint();
        }
        return existing.id;
      }
      const now = Date.now();
      const id = generateId();
      const workspaceTargetId = resolveConversationWorkspaceTargetId();
      const semanticMemoryHandoff =
        options?.activate === false ? undefined : captureActiveMemoryHandoff(get);
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
        ...(semanticMemoryHandoff ? { semanticMemoryHandoff } : {}),
      };
      set((state) => ({
        conversations: [newConversation, ...state.conversations],
        activeConversationId: options?.activate === false ? state.activeConversationId : id,
      }));
      requestChatStorePersistenceCheckpoint();
      return id;
    },

    createSideThread: (parentConversationId, options) => {
      const { conversations, activeConversationId } = get();
      const parent = conversations.find((c) => c.id === parentConversationId);
      if (!parent) return null;
      if (parent.isSideThread) return null;

      const now = Date.now();
      const id = generateId();
      const workspaceTargetId = resolveConversationWorkspaceTargetId(parent.workspaceTargetId);
      const active = activeConversationId
        ? conversations.find((conversation) => conversation.id === activeConversationId)
        : undefined;
      const source =
        active?.id === parent.id ||
        (active?.isSideThread && active.parentConversationId === parent.id)
          ? active
          : parent;
      const semanticMemoryHandoff =
        options?.activate === false ? undefined : captureSemanticMemoryHandoff(source);
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
        ...(semanticMemoryHandoff ? { semanticMemoryHandoff } : {}),
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
      retireConversationDeletionTargets(get, [
        {
          conversationId: target.id,
          memoryConversationId: resolveConversationWorkspaceTarget({
            conversationId: target.id,
            conversations,
          }).workspaceConversationId,
          sourceThreadId: target.id,
          messages: target.messages,
        },
      ]);
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
      set((state) => ({
        conversations: id ? attachActivationMemoryHandoff(state, id) : state.conversations,
        activeConversationId: id,
      }));
      requestChatStorePersistenceCheckpoint();
    },

    deleteConversation: (id) => {
      const matches = get().conversations.filter((conversation) => conversation.id === id);
      if (matches.length > 1) {
        throw new Error('conversation_delete_identity_invalid');
      }
      if (matches.length === 0) return;
      const target = matches[0]!;
      retireConversationDeletionTargets(get, [
        {
          conversationId: id,
          memoryConversationId: resolveConversationWorkspaceTarget({
            conversationId: id,
            conversations: get().conversations,
          }).workspaceConversationId,
          sourceThreadId: id,
          messages: target.messages,
        },
      ]);
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== id),
        activeConversationId: state.activeConversationId === id ? null : state.activeConversationId,
      }));
      requestChatStorePersistenceCheckpoint();
    },

    clearAllConversations: () => {
      retireConversationDeletionTargets(
        get,
        get().conversations.map((conversation) => ({
          conversationId: conversation.id,
          memoryConversationId: resolveConversationWorkspaceTarget({
            conversationId: conversation.id,
            conversations: get().conversations,
          }).workspaceConversationId,
          sourceThreadId: conversation.id,
          messages: conversation.messages,
        })),
      );
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
