import { useCallback, type MutableRefObject } from 'react';
import { SUPER_AGENT_PERSONA_ID } from '../../../services/agents/personas';
import { importConversationWorkspaceAttachment } from '../../../services/conversationWorkspace/attachments';
import { getComposerDraftKey } from '../../../screens/chatComposerDrafts';
import { useChatStore } from '../../../store/useChatStore';
import type { Attachment } from '../../../types/attachment';
import type { Conversation } from '../../../types/conversation';
import type { Message } from '../../../types/message';
import {
  rewindForegroundConversationRun,
  stopForegroundConversationRuns,
} from '../foregroundConversationCancellation';
import {
  applyForegroundEditedResend,
  applyForegroundRetryResend,
} from '../foregroundConversationReplay';
import type { EnsureAgentRunFinalResponse, RunChatOptions } from './contracts';
import type {
  ForegroundConversationRunHelpers,
  ForegroundRunLogEntryInput,
} from './executionTypes';

type ChatStoreState = ReturnType<typeof useChatStore.getState>;

type UseForegroundConversationActionsParams = {
  activeConversation: Conversation | undefined;
  activeConversationId: string | null;
  addMessage: ChatStoreState['addMessage'];
  appendConversationLog: (conversationId: string, entry: ForegroundRunLogEntryInput) => void;
  attachmentWorkspaceImportFailedMessage: string;
  abortForegroundRequestForConversation: (conversationId: string, reason?: string) => void;
  clearComposerDraft: (draftKey: string) => void;
  clearForegroundRequestForConversation: (conversationId: string) => void;
  completeAgentRun: ChatStoreState['completeAgentRun'];
  defaultConversationMode: Conversation['mode'];
  editMessage: ChatStoreState['editMessage'];
  editingMessageId: string | null;
  ensureAgentRunFinalResponse: EnsureAgentRunFinalResponse;
  ensureCanonicalConversation: ForegroundConversationRunHelpers['ensureCanonicalConversation'];
  forceNextScrollRef: MutableRefObject<boolean>;
  generateId: () => string;
  isAgenticMode: boolean;
  pendingAgentRunAsyncResumesRef: MutableRefObject<Map<string, Promise<void>>>;
  pendingAgentRunFinalizationsRef: MutableRefObject<Map<string, Promise<string | undefined>>>;
  pendingAgentRunTerminalReviewsRef: MutableRefObject<Map<string, Promise<void>>>;
  requestChatStorePersistenceCheckpoint: (delayMs?: number) => void;
  runChat: (conversationId: string, options?: RunChatOptions) => Promise<void>;
  setChatError: (message: string | null) => void;
  setEditingContent: (content: string | undefined) => void;
  setEditingMessageId: (messageId: string | null) => void;
  updateAgentRunControlGraph: ChatStoreState['updateAgentRunControlGraph'];
};

export function useForegroundConversationActions(params: UseForegroundConversationActionsParams): {
  handleEditSend: (text: string, attachments?: Attachment[]) => void;
  handleRetry: (messageId: string) => void;
  handleSend: (text: string, attachments?: Attachment[]) => Promise<void>;
  handleStop: () => void;
} {
  const {
    abortForegroundRequestForConversation,
    activeConversation,
    activeConversationId,
    addMessage,
    appendConversationLog,
    attachmentWorkspaceImportFailedMessage,
    clearComposerDraft,
    clearForegroundRequestForConversation,
    completeAgentRun,
    defaultConversationMode,
    editMessage,
    editingMessageId,
    ensureAgentRunFinalResponse,
    ensureCanonicalConversation,
    forceNextScrollRef,
    generateId,
    isAgenticMode,
    pendingAgentRunAsyncResumesRef,
    pendingAgentRunFinalizationsRef,
    pendingAgentRunTerminalReviewsRef,
    requestChatStorePersistenceCheckpoint,
    runChat,
    setChatError,
    setEditingContent,
    setEditingMessageId,
    updateAgentRunControlGraph,
  } = params;

  const clearPendingRunState = useCallback(
    (runId: string) => {
      pendingAgentRunFinalizationsRef.current.delete(runId);
      pendingAgentRunTerminalReviewsRef.current.delete(runId);
      pendingAgentRunAsyncResumesRef.current.delete(runId);
    },
    [pendingAgentRunAsyncResumesRef, pendingAgentRunFinalizationsRef, pendingAgentRunTerminalReviewsRef],
  );

  const getConversation = useCallback(
    (conversationId: string) =>
      useChatStore.getState().conversations.find((candidate) => candidate.id === conversationId),
    [],
  );

  const getLiveActiveConversationId = useCallback(
    () => useChatStore.getState().activeConversationId ?? activeConversationId,
    [activeConversationId],
  );

  const cancelConversationRunForRewind = useCallback(
    (conversationId: string, reason: string) => {
      rewindForegroundConversationRun({
        abortForegroundRequestForConversation: (conversationId, reason) => {
          abortForegroundRequestForConversation(conversationId, reason);
          return true;
        },
        clearPendingRunState,
        conversation: getConversation(conversationId),
        conversationId,
        reason,
      });
    },
    [abortForegroundRequestForConversation, clearPendingRunState, getConversation],
  );

  const handleSend = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      setChatError(null);

      let conversationId = getLiveActiveConversationId();
      if (!conversationId) {
        conversationId = ensureCanonicalConversation({
          personaId: isAgenticMode ? SUPER_AGENT_PERSONA_ID : undefined,
          mode: defaultConversationMode,
          reportMissingProvider: true,
        });
        if (!conversationId) {
          return;
        }
      }

      let preparedAttachments = attachments;
      if (attachments?.length) {
        try {
          preparedAttachments = await Promise.all(
            attachments.map(
              async (attachment) =>
                (await importConversationWorkspaceAttachment(conversationId, attachment))
                  .attachment,
            ),
          );
        } catch (error) {
          console.warn('Failed to import chat attachments into the conversation workspace.', error);
          setChatError(attachmentWorkspaceImportFailedMessage);
          return;
        }
      }

      forceNextScrollRef.current = true;
      addMessage(conversationId, {
        id: generateId(),
        role: 'user',
        content: text,
        attachments: preparedAttachments,
      } as Partial<Message> & Pick<Message, 'content' | 'id' | 'role'>);

      clearComposerDraft(getComposerDraftKey(conversationId));
      await runChat(conversationId);
    },
    [
      addMessage,
      attachmentWorkspaceImportFailedMessage,
      clearComposerDraft,
      defaultConversationMode,
      ensureCanonicalConversation,
      forceNextScrollRef,
      generateId,
      getLiveActiveConversationId,
      isAgenticMode,
      runChat,
      setChatError,
    ],
  );

  const handleStop = useCallback(() => {
    const conversationId = getLiveActiveConversationId();
    if (conversationId) {
      stopForegroundConversationRuns({
        abortForegroundRequestForConversation: (conversationId, reason) => {
          abortForegroundRequestForConversation(conversationId, reason);
          return true;
        },
        actions: {
          appendConversationLog,
          clearForegroundRequestForConversation: (conversationId) => {
            clearForegroundRequestForConversation(conversationId);
            return true;
          },
          clearPendingRunState,
          completeAgentRun,
          ensureAgentRunFinalResponse,
          getLatestConversation: (conversationId) => getConversation(conversationId),
          updateAgentRunControlGraph,
        },
        conversation: getConversation(conversationId),
        conversationId,
      });
    }

    requestChatStorePersistenceCheckpoint();
  }, [
    abortForegroundRequestForConversation,
    appendConversationLog,
    clearForegroundRequestForConversation,
    clearPendingRunState,
    completeAgentRun,
    ensureAgentRunFinalResponse,
    getConversation,
    getLiveActiveConversationId,
    requestChatStorePersistenceCheckpoint,
    updateAgentRunControlGraph,
  ]);

  const handleResend = useCallback(async () => {
    setChatError(null);
    const conversationId = getLiveActiveConversationId();
    if (!conversationId) {
      return;
    }
    await runChat(conversationId);
  }, [getLiveActiveConversationId, runChat, setChatError]);

  const handleEditSend = useCallback(
    (text: string, _attachments?: Attachment[]) => {
      const conversationId = getLiveActiveConversationId();
      if (
        applyForegroundEditedResend({
          actions: {
            cancelConversationRunForRewind,
            editMessage,
          },
          conversationId: conversationId ?? undefined,
          editingMessageId: editingMessageId ?? undefined,
          text,
        })
      ) {
        setEditingMessageId(null);
        setEditingContent(undefined);
        void handleResend();
      }
    },
    [
      cancelConversationRunForRewind,
      editMessage,
      editingMessageId,
      getLiveActiveConversationId,
      handleResend,
      setEditingContent,
      setEditingMessageId,
    ],
  );

  const handleRetry = useCallback(
    (messageId: string) => {
      const conversationId = getLiveActiveConversationId();
      if (
        applyForegroundRetryResend({
          actions: {
            cancelConversationRunForRewind,
            editMessage,
          },
          assistantMessageId: messageId,
          conversation: conversationId ? getConversation(conversationId) : activeConversation,
          conversationId: conversationId ?? undefined,
        })
      ) {
        void handleResend();
      }
    },
    [
      cancelConversationRunForRewind,
      editMessage,
      getConversation,
      getLiveActiveConversationId,
      handleResend,
      activeConversation,
    ],
  );

  return {
    handleEditSend,
    handleRetry,
    handleSend,
    handleStop,
  };
}
