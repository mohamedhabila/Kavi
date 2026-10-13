// ---------------------------------------------------------------------------
// Kavi — Chat Store (Zustand)
// ---------------------------------------------------------------------------
// Boundary: this module owns the persisted Zustand shell only.
//   - Conversation/message CRUD → chatStoreConversationActions, chatStoreMessageActions
//   - Usage/logging → chatStoreUsageActions
//   - Agent-run graph state → agentRuns/storeActions (delegates to agentRuns/*)
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEYS } from '../constants/storage';
import { createThrottledJSONStorage } from './throttledStorage';
import { drainPendingTranscriptArchive } from '../services/transcriptArchive/transcriptArchive';
import { bindConversationFocus } from '../services/memory/core/memoryExtractionWorker';
import { partializeChatPersistState } from './chatPersistence';
import { createAgentRunStoreActions } from './agentRuns/storeActions';
import { createConversationStoreActions } from './chatStoreConversationActions';
import { createMessageStoreActions } from './chatStoreMessageActions';
import { normalizePersistedChatState } from './chatStoreNormalization';
import { startOverFromOtherVersion } from './persistedStoreVersion';
import { createUsageStoreActions } from './chatStoreUsageActions';
import type { ChatState } from './chatStoreTypes';

export type { ChatState } from './chatStoreTypes';

const CHAT_STORE_VERSION = 9;

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
      ...createConversationStoreActions(set, get),
      ...createMessageStoreActions(set),
      ...createUsageStoreActions(set),
      ...createAgentRunStoreActions(set),
    }),
    {
      name: STORAGE_KEYS.CONVERSATIONS,
      // Archived history must be durable before a generation that omits it is committed.
      storage: createThrottledJSONStorage({ beforeCommit: drainPendingTranscriptArchive }),
      version: CHAT_STORE_VERSION,
      migrate: startOverFromOtherVersion,
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizePersistedChatState(persistedState as Partial<ChatState> | undefined),
      }),
      partialize: (state) => partializeChatPersistState(state),
    },
  ),
);

bindConversationFocus({
  read: (conversationId) =>
    useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.title.trim() || null,
  apply: (conversationId, focus) =>
    useChatStore.getState().setConversationFocus(conversationId, focus),
});
