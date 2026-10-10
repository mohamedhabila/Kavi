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
import { partializeChatPersistState } from './chatPersistence';
import { createAgentRunStoreActions } from './agentRuns/storeActions';
import { createConversationStoreActions } from './chatStoreConversationActions';
import { createMessageStoreActions } from './chatStoreMessageActions';
import { CHAT_STORE_VERSION, migrateChatStoreState } from './chatStoreMigrations';
import { normalizePersistedChatState } from './chatStoreNormalization';
import { createUsageStoreActions } from './chatStoreUsageActions';
import type { ChatState } from './chatStoreTypes';

export type { ChatState } from './chatStoreTypes';
export { collapseConversationsToCanonical } from './chatStoreNormalization';

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
      migrate: (persistedState: unknown, persistedVersion: number) => {
        const normalized = normalizePersistedChatState(
          migrateChatStoreState(persistedState, persistedVersion),
        );
        return partializeChatPersistState(normalized);
      },
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizePersistedChatState(persistedState as Partial<ChatState> | undefined),
      }),
      partialize: (state) => partializeChatPersistState(state),
    },
  ),
);
