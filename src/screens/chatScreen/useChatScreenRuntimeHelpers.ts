import { useCallback, type MutableRefObject } from 'react';
import {
  publishConversationTurnMemory,
  type RecordConversationTurnMemory,
} from '../../services/memory/turnPublication';
import { createAgentRunIdentityKey } from '../../services/agents/agentRunIdentity';
import { useChatStore } from '../../store/useChatStore';
import type { ConversationLogEntry } from '../../types/conversation';
import { truncateLogDetail } from '../chatFormatting';

type ChatStoreState = ReturnType<typeof useChatStore.getState>;

type UseChatScreenRuntimeHelpersParams = {
  addConversationLog: ChatStoreState['addConversationLog'];
  pendingAgentRunAsyncResumesRef: MutableRefObject<Map<string, Promise<void>>>;
  pendingAgentRunFinalizationsRef: MutableRefObject<Map<string, Promise<string | undefined>>>;
  pendingAgentRunTerminalReviewsRef: MutableRefObject<Map<string, Promise<void>>>;
};

export function useChatScreenRuntimeHelpers(params: UseChatScreenRuntimeHelpersParams): {
  appendConversationLog: (
    conversationId: string,
    entry: {
      title: string;
      detail?: string;
      level?: ConversationLogEntry['level'];
      kind?: ConversationLogEntry['kind'];
      timestamp?: number;
    },
  ) => void;
  clearPendingRunState: (conversationId: string, runId: string) => void;
  getConversation: (conversationId: string) => ReturnType<ChatStoreState['conversations']['find']>;
  getConversations: () => ChatStoreState['conversations'];
  recordConversationTurnMemory: RecordConversationTurnMemory;
} {
  const appendConversationLog = useCallback(
    (
      conversationId: string,
      entry: {
        title: string;
        detail?: string;
        level?: ConversationLogEntry['level'];
        kind?: ConversationLogEntry['kind'];
        timestamp?: number;
      },
    ) => {
      params.addConversationLog(conversationId, {
        ...entry,
        detail: truncateLogDetail(entry.detail),
      });
    },
    [params],
  );

  const getConversation = useCallback(
    (conversationId: string) =>
      useChatStore.getState().conversations.find((candidate) => candidate.id === conversationId),
    [],
  );

  const getConversations = useCallback(() => useChatStore.getState().conversations, []);

  const clearPendingRunState = useCallback(
    (conversationId: string, runId: string) => {
      const runIdentityKey = createAgentRunIdentityKey({ conversationId, runId });
      params.pendingAgentRunFinalizationsRef.current.delete(runIdentityKey);
      params.pendingAgentRunTerminalReviewsRef.current.delete(runIdentityKey);
      params.pendingAgentRunAsyncResumesRef.current.delete(runIdentityKey);
    },
    [
      params.pendingAgentRunAsyncResumesRef,
      params.pendingAgentRunFinalizationsRef,
      params.pendingAgentRunTerminalReviewsRef,
    ],
  );

  return {
    appendConversationLog,
    clearPendingRunState,
    getConversation,
    getConversations,
    recordConversationTurnMemory: publishConversationTurnMemory,
  };
}
