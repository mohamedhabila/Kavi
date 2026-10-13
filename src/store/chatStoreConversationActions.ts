import type { StoreApi } from 'zustand';
import { generateId } from '../utils/id';
import { getDefaultConversationTitle } from '../utils/conversation';
import { truncateGraphemesTo } from '../utils/graphemes';
import { requestChatStorePersistenceCheckpoint } from './chatStorePersistence';
import { resolveConversationWorkspaceTargetId } from './chatStoreHelpers';
import type { ChatState } from './chatStoreTypes';
import { deleteConversationMemory } from '../services/memory/core/memoryCapture';
import { createLogger } from '../utils/logger';
import {
  deleteAllArchivedMessages,
  deleteArchivedConversation,
} from '../services/transcriptArchive/transcriptArchive';

/** A user-chosen chat name is a label, not content: bounded so a paste cannot become one. */
export const MAX_CONVERSATION_TITLE_GRAPHEMES = 120;

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

const logger = createLogger('ChatStoreConversations');

/**
 * Remove a deleted conversation's archived history. The deletion itself must not fail on it:
 * whatever is left is removed when the app next starts.
 */
function removeArchivedHistory(remove: () => void): void {
  try {
    remove();
  } catch (error: unknown) {
    logger.warn(
      'Archived history will be removed on the next launch; it could not be removed now.',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

export function createConversationStoreActions(
  set: ChatStoreSet,
  get: ChatStoreGet,
): Pick<
  ChatState,
  | 'createConversation'
  | 'getOrCreateCanonicalThread'
  | 'setActiveConversation'
  | 'deleteConversation'
  | 'renameConversation'
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
        ...(replaceCanonical ? { isCanonical: true } : { isStandaloneThread: true }),
        usage: buildEmptyConversationUsage(),
        logs: [],
        agentRuns: [],
        ...(workspaceTargetId ? { workspaceTargetId } : {}),
      };
      set((state) => {
        const personaKey = options?.personaId?.length ? options.personaId : '__default__';
        const existingConversations = replaceCanonical
          ? state.conversations.map((conversation) => {
              const conversationPersonaKey = conversation.personaId?.length
                ? conversation.personaId
                : '__default__';
              if (
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
        if (c.isStandaloneThread || c.archivedFromMigration) return false;
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

    setActiveConversation: (id) => {
      set({ activeConversationId: id });
      requestChatStorePersistenceCheckpoint();
    },

    deleteConversation: (id) => {
      const matches = get().conversations.filter((conversation) => conversation.id === id);
      if (matches.length > 1) {
        throw new Error('conversation_delete_identity_invalid');
      }
      if (matches.length === 0) return;
      deleteConversationMemory(id);
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== id),
        activeConversationId: state.activeConversationId === id ? null : state.activeConversationId,
      }));
      removeArchivedHistory(() => deleteArchivedConversation(id));
      requestChatStorePersistenceCheckpoint();
    },

    renameConversation: (id, title) => {
      const nextTitle = truncateGraphemesTo(
        title.replace(/\s+/gu, ' ').trim(),
        MAX_CONVERSATION_TITLE_GRAPHEMES,
      );
      if (!nextTitle) return;
      set((state) => ({
        conversations: state.conversations.map((conversation) =>
          conversation.id === id ? { ...conversation, title: nextTitle } : conversation,
        ),
      }));
      requestChatStorePersistenceCheckpoint();
    },

    clearAllConversations: () => {
      for (const conversation of get().conversations) deleteConversationMemory(conversation.id);
      set({ conversations: [], activeConversationId: null });
      removeArchivedHistory(deleteAllArchivedMessages);
      requestChatStorePersistenceCheckpoint();
    },

    updateModelInConversation: (conversationId, providerId, model) =>
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === conversationId ? { ...c, providerId, modelOverride: model } : c,
        ),
      })),

    updatePersonaInConversation: (conversationId, personaId, options) => {
      set((state) => ({
        conversations: state.conversations.map((c) => {
          if (c.id !== conversationId) return c;
          const previousPersonaId = c.personaId;
          const shouldRecordEvent =
            options?.recordEvent !== false &&
            previousPersonaId !== personaId &&
            c.messages.length > 0;
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
