import { useCallback, useRef, type MutableRefObject } from 'react';
import { SUPER_AGENT_PERSONA_ID } from '../../../services/agents/personas';
import { importConversationWorkspaceAttachment } from '../../../services/conversationWorkspace/attachments';
import { createAgentRunIdentityKey } from '../../../services/agents/agentRunIdentity';
import { getComposerDraftKey } from '../../../screens/chatComposerDrafts';
import { waitForPersistedAgentRecoveryReadiness } from '../../../services/startupRecovery';
import { waitForModelProjectionAvailability } from '../../../store/modelProjectionOwnership';
import { beginModelProjectionIntent } from '../../../store/modelProjectionIntentCoordinator';
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
  rewindUserMessageForResend: ChatStoreState['rewindUserMessageForResend'];
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
  handleEditSend: (text: string, attachments?: Attachment[]) => Promise<void>;
  handleRetry: (messageId: string) => Promise<void>;
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
    rewindUserMessageForResend,
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
  const pendingConversationWritesRef = useRef(new Set<string>());

  const reserveConversationWrite = useCallback((conversationId: string): boolean => {
    if (pendingConversationWritesRef.current.has(conversationId)) return false;
    pendingConversationWritesRef.current.add(conversationId);
    return true;
  }, []);

  const releaseConversationWrite = useCallback((conversationId: string): void => {
    pendingConversationWritesRef.current.delete(conversationId);
  }, []);

  const clearPendingRunState = useCallback(
    (conversationId: string, runId: string) => {
      const runIdentityKey = createAgentRunIdentityKey({ conversationId, runId });
      pendingAgentRunFinalizationsRef.current.delete(runIdentityKey);
      pendingAgentRunTerminalReviewsRef.current.delete(runIdentityKey);
      pendingAgentRunAsyncResumesRef.current.delete(runIdentityKey);
    },
    [
      pendingAgentRunAsyncResumesRef,
      pendingAgentRunFinalizationsRef,
      pendingAgentRunTerminalReviewsRef,
    ],
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

  const waitForConversationWriteAvailability = useCallback(
    async (conversationId: string, reason: string): Promise<boolean> => {
      abortForegroundRequestForConversation(conversationId, reason);
      try {
        await waitForPersistedAgentRecoveryReadiness();
        await waitForModelProjectionAvailability({
          conversationId,
          signal: new AbortController().signal,
        });
        return true;
      } catch (error) {
        setChatError(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [abortForegroundRequestForConversation, setChatError],
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
      if (!reserveConversationWrite(conversationId)) return;

      let writeIntent: ReturnType<typeof beginModelProjectionIntent> | undefined;
      try {
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
            console.warn(
              'Failed to import chat attachments into the conversation workspace.',
              error,
            );
            setChatError(attachmentWorkspaceImportFailedMessage);
            return;
          }
        }

        if (
          !(await waitForConversationWriteAvailability(
            conversationId,
            'Superseded by a new user turn.',
          ))
        ) {
          return;
        }

        writeIntent = beginModelProjectionIntent(conversationId, 'conversation-write');
        forceNextScrollRef.current = true;
        addMessage(conversationId, {
          id: generateId(),
          role: 'user',
          content: text,
          attachments: preparedAttachments,
        } as Partial<Message> & Pick<Message, 'content' | 'id' | 'role'>);

        clearComposerDraft(getComposerDraftKey(conversationId));
        const execution = runChat(conversationId);
        writeIntent.release();
        writeIntent = undefined;
        releaseConversationWrite(conversationId);
        await execution;
      } finally {
        writeIntent?.release();
        releaseConversationWrite(conversationId);
      }
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
      releaseConversationWrite,
      reserveConversationWrite,
      runChat,
      setChatError,
      waitForConversationWriteAvailability,
    ],
  );

  const handleStop = useCallback(() => {
    const conversationId = getLiveActiveConversationId();
    if (conversationId) {
      void stopForegroundConversationRuns({
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
      }).finally(() => {
        requestChatStorePersistenceCheckpoint();
      });
    }
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

  const handleResend = useCallback(
    async (conversationId: string) => {
      setChatError(null);
      await runChat(conversationId);
    },
    [runChat, setChatError],
  );

  const handleEditSend = useCallback(
    async (text: string, _attachments?: Attachment[]) => {
      const conversationId = getLiveActiveConversationId();
      if (!conversationId || !reserveConversationWrite(conversationId)) return;
      let writeIntent: ReturnType<typeof beginModelProjectionIntent> | undefined;
      try {
        if (
          !(await waitForConversationWriteAvailability(
            conversationId,
            'Superseded by an edited user turn.',
          ))
        ) {
          return;
        }
        writeIntent = beginModelProjectionIntent(conversationId, 'conversation-write');
        if (
          applyForegroundEditedResend({
            actions: {
              cancelConversationRunForRewind,
              rewindUserMessageForResend,
            },
            conversationId,
            editingMessageId: editingMessageId ?? undefined,
            text,
          })
        ) {
          setEditingMessageId(null);
          setEditingContent(undefined);
          const execution = handleResend(conversationId);
          writeIntent.release();
          writeIntent = undefined;
          releaseConversationWrite(conversationId);
          await execution;
        }
      } finally {
        writeIntent?.release();
        releaseConversationWrite(conversationId);
      }
    },
    [
      cancelConversationRunForRewind,
      rewindUserMessageForResend,
      editingMessageId,
      getLiveActiveConversationId,
      handleResend,
      releaseConversationWrite,
      reserveConversationWrite,
      setEditingContent,
      setEditingMessageId,
      waitForConversationWriteAvailability,
    ],
  );

  const handleRetry = useCallback(
    async (messageId: string) => {
      const conversationId = getLiveActiveConversationId();
      if (!conversationId || !reserveConversationWrite(conversationId)) return;
      let writeIntent: ReturnType<typeof beginModelProjectionIntent> | undefined;
      try {
        if (
          !(await waitForConversationWriteAvailability(
            conversationId,
            'Superseded by a retried response.',
          ))
        ) {
          return;
        }
        writeIntent = beginModelProjectionIntent(conversationId, 'conversation-write');
        if (
          applyForegroundRetryResend({
            actions: {
              cancelConversationRunForRewind,
              rewindUserMessageForResend,
            },
            assistantMessageId: messageId,
            conversation: getConversation(conversationId) ?? activeConversation,
            conversationId,
          })
        ) {
          const execution = handleResend(conversationId);
          writeIntent.release();
          writeIntent = undefined;
          releaseConversationWrite(conversationId);
          await execution;
        }
      } finally {
        writeIntent?.release();
        releaseConversationWrite(conversationId);
      }
    },
    [
      cancelConversationRunForRewind,
      rewindUserMessageForResend,
      getConversation,
      getLiveActiveConversationId,
      handleResend,
      releaseConversationWrite,
      reserveConversationWrite,
      activeConversation,
      waitForConversationWriteAvailability,
    ],
  );

  return {
    handleEditSend,
    handleRetry,
    handleSend,
    handleStop,
  };
}
