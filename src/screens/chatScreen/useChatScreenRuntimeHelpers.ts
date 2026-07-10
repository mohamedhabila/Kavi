import { useCallback, type MutableRefObject } from 'react';
import { recordCompletedTurnForMemory } from '../../services/memory/lifecycle';
import { resolveCodeOwnedMemoryConversationId } from '../../services/memory/memoryScopeIdentity';
import { createAgentRunIdentityKey } from '../../services/agents/agentRunIdentity';
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

type RecordConversationTurnMemoryOptions = {
  memoryConversationId?: string | null;
  sourceRunId?: string;
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
  recordConversationTurnMemory: (
    conversationId: string,
    activeChatProvider?: LlmProviderConfig,
    options?: RecordConversationTurnMemoryOptions,
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

  const recordConversationTurnMemory = useCallback(
    (
      conversationId: string,
      activeChatProvider?: LlmProviderConfig,
      options: RecordConversationTurnMemoryOptions = {},
    ) => {
      const latestConversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === conversationId);
      if (!latestConversation) {
        return;
      }

      const memoryConversationId = resolveCodeOwnedMemoryConversationId(
        options.memoryConversationId,
        conversationId,
      );
      void recordCompletedTurnForMemory({
        threadId: conversationId,
        memoryConversationId,
        messages: latestConversation.messages,
        threadTitle: latestConversation.title,
        activeChatProvider,
        sourceRunId: options.sourceRunId,
      }).catch(() => undefined);
    },
    [],
  );

  return {
    appendConversationLog,
    clearPendingRunState,
    getConversation,
    getConversations,
    recordConversationTurnMemory,
  };
}
