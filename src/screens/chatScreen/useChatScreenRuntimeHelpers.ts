import { useCallback, type MutableRefObject } from 'react';
import { recordCompletedTurnForMemory } from '../../services/memory/lifecycle';
import { useChatStore } from '../../store/useChatStore';
import type { ConversationLogEntry } from '../../types/conversation';
import type { LlmProviderConfig } from '../../types/provider';
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
  clearPendingRunState: (runId: string) => void;
  getConversation: (conversationId: string) => ReturnType<ChatStoreState['conversations']['find']>;
  getConversations: () => ChatStoreState['conversations'];
  recordConversationTurnMemory: (
    conversationId: string,
    activeChatProvider?: LlmProviderConfig,
  ) => void;
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
    (runId: string) => {
      params.pendingAgentRunFinalizationsRef.current.delete(runId);
      params.pendingAgentRunTerminalReviewsRef.current.delete(runId);
      params.pendingAgentRunAsyncResumesRef.current.delete(runId);
    },
    [
      params.pendingAgentRunAsyncResumesRef,
      params.pendingAgentRunFinalizationsRef,
      params.pendingAgentRunTerminalReviewsRef,
    ],
  );

  const recordConversationTurnMemory = useCallback((
    conversationId: string,
    activeChatProvider?: LlmProviderConfig,
  ) => {
    const latestConversation = useChatStore
      .getState()
      .conversations.find((candidate) => candidate.id === conversationId);
    if (!latestConversation) {
      return;
    }

    void recordCompletedTurnForMemory({
      threadId: conversationId,
      messages: latestConversation.messages,
      threadTitle: latestConversation.title,
      activeChatProvider,
    }).catch(() => undefined);
  }, []);

  return {
    appendConversationLog,
    clearPendingRunState,
    getConversation,
    getConversations,
    recordConversationTurnMemory,
  };
}
