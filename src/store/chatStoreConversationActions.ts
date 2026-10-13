import type { StoreApi } from 'zustand';
import { generateId } from '../utils/id';
import { getDefaultConversationTitle } from '../utils/conversation';
import { requestChatStorePersistenceCheckpoint } from './chatStorePersistence';
import { resolveConversationWorkspaceTargetId } from './chatStoreHelpers';
import type { Conversation, ConversationMode } from '../types/conversation';
import type { ChatState } from './chatStoreTypes';
import { forgetConversationHistory } from '../services/memory/core/memoryCapture';
import { createLogger } from '../utils/logger';
import { deleteAllArchivedMessages } from '../services/transcriptArchive/transcriptArchive';

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


/** A new, empty conversation, attached to the default workspace target when one is set. */
export function buildConversation(params: {
  providerId: string;
  systemPrompt: string;
  modelOverride?: string;
  personaId?: string;
  mode?: ConversationMode;
}): Conversation {
  const now = Date.now();
  const workspaceTargetId = resolveConversationWorkspaceTargetId();
  return {
    id: generateId(),
    title: getDefaultConversationTitle(),
    messages: [],
    providerId: params.providerId,
    modelOverride: params.modelOverride,
    systemPrompt: params.systemPrompt,
    createdAt: now,
    updatedAt: now,
    personaId: params.personaId,
    mode: params.mode,
    usage: buildEmptyConversationUsage(),
    logs: [],
    agentRuns: [],
    ...(workspaceTargetId ? { workspaceTargetId } : {}),
  };
}

const logger = createLogger('ChatStoreConversations');

/**
 * Remove archived history while clearing the chat history. The clear itself must not fail on
 * it: whatever is left is removed when the app next starts.
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
  | 'ensureConversation'
  | 'clearChatHistory'
  | 'updateModelInConversation'
  | 'updatePersonaInConversation'
  | 'updateModeInConversation'
> {
  return {
    ensureConversation: (providerId, systemPrompt, modelOverride, options) => {
      const { conversations, activeConversationId } = get();
      const existing =
        conversations.find((conversation) => conversation.id === activeConversationId) ??
        conversations.reduce<Conversation | undefined>(
          (latest, conversation) =>
            !latest || conversation.updatedAt > latest.updatedAt ? conversation : latest,
          undefined,
        );
      if (existing) {
        if (existing.id !== activeConversationId) {
          set({ activeConversationId: existing.id });
          requestChatStorePersistenceCheckpoint();
        }
        return existing.id;
      }
      const conversation = buildConversation({
        providerId,
        systemPrompt,
        modelOverride,
        personaId: options?.personaId,
        mode: options?.mode,
      });
      set((state) => ({
        conversations: [conversation, ...state.conversations],
        activeConversationId: conversation.id,
      }));
      requestChatStorePersistenceCheckpoint();
      return conversation.id;
    },

    clearChatHistory: () => {
      for (const conversation of get().conversations) forgetConversationHistory(conversation.id);
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
