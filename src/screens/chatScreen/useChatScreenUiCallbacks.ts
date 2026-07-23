import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { Alert } from 'react-native';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import { shareConversationWorkspaceFile } from '../../services/share/localShare';
import type { Attachment } from '../../types/attachment';
import type { Conversation } from '../../types/conversation';
import type { Message } from '../../types/message';
import { hasCompleteFinalAssistantMetadata } from '../../utils/assistantMessageMetadata';
import { CHAT_SOURCE_MESSAGE_PAGE_SIZE } from '../chatScreenDisplayState';
import { resolveConversationWorkspaceTarget } from '../../services/conversationWorkspace/ownership';
import { resolveConversationWorkspaceReadScope } from '../../services/conversationWorkspace/fallbacks';
import {
  readExplicitMemoryRetrievalFeedback,
  recordExplicitMemoryRetrievalFeedback,
  type MemoryRetrievalFeedbackChoice,
  type MemoryRetrievalFeedbackTarget,
} from '../../services/memory/retrievalOutcomeStore';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

type SubAgentSnapshot = NonNullable<Message['subAgentEvent']>['snapshot'];

type UseChatScreenUiCallbacksParams = {
  activeConversation?: Conversation;
  activeConversationId: string | null;
  conversations: ReadonlyArray<Conversation>;
  createSideThread?: (conversationId: string) => void;
  discardSideThread?: (conversationId: string) => void;
  navigation: Pick<DrawerNavigationProp<any>, 'navigate'>;
  setChatError: (message: string | null) => void;
  setEditingContent: (content: string | undefined) => void;
  setEditingMessageId: (messageId: string | null) => void;
  setSelectedSubAgentSnapshot: (snapshot: SubAgentSnapshot | null) => void;
  setVisibleSourceMessageLimit: Dispatch<SetStateAction<number>>;
  shareFileFailedMessage: string;
  t: TranslationFn;
  workspaceFallbackConversationIds: string[];
};

export function useChatScreenUiCallbacks(params: UseChatScreenUiCallbacksParams): {
  handleEdit: (messageId: string, content: string) => void;
  handleLoadMemoryFeedback: (
    messageId: string,
    eventId: string,
  ) => Promise<MemoryRetrievalFeedbackChoice | null>;
  handleMemoryFeedback: (
    messageId: string,
    eventId: string,
    outcome: MemoryRetrievalFeedbackChoice,
  ) => Promise<MemoryRetrievalFeedbackChoice>;
  handleOpenSubAgentDetails: (snapshot: SubAgentSnapshot) => void;
  handleShareWorkspaceFile: (attachment: Attachment) => Promise<void>;
  handleShowEarlierMessages: () => void;
  handleToggleSideThread: () => void;
  handleViewFiles: (path?: string) => void;
} {
  const {
    activeConversation,
    activeConversationId,
    conversations,
    createSideThread,
    discardSideThread,
    navigation,
    setChatError,
    setEditingContent,
    setEditingMessageId,
    setSelectedSubAgentSnapshot,
    setVisibleSourceMessageLimit,
    shareFileFailedMessage,
    t,
    workspaceFallbackConversationIds,
  } = params;
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;

  const handleEdit = useCallback(
    (messageId: string, content: string) => {
      setEditingMessageId(messageId);
      setEditingContent(content);
    },
    [setEditingContent, setEditingMessageId],
  );

  const handleViewFiles = useCallback(
    (path?: string) => {
      if (!activeConversationId) {
        return;
      }

      navigationRef.current.navigate('ConversationFiles' as any, {
        conversationId: activeConversationId,
        initialFilePath: path ?? undefined,
      });
    },
    [activeConversationId],
  );

  const handleToggleSideThread = useCallback(() => {
    if (!activeConversation) {
      return;
    }

    if (activeConversation.isSideThread) {
      Alert.alert(t('chat.discardSideThreadConfirmTitle'), t('chat.discardSideThreadConfirmBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('chat.discardSideThreadAction'),
          style: 'destructive',
          onPress: () => discardSideThread?.(activeConversation.id),
        },
      ]);
      return;
    }

    createSideThread?.(activeConversation.id);
  }, [activeConversation, createSideThread, discardSideThread, t]);

  const handleShareWorkspaceFile = useCallback(
    async (attachment: Attachment) => {
      if (!activeConversationId || !attachment.workspacePath) {
        return;
      }

      try {
        const workspaceScope = resolveConversationWorkspaceReadScope({
          conversationId: activeConversationId,
          conversations,
          messages: activeConversation?.messages,
          usageEntries: activeConversation?.usage?.entries,
          agentRuns: activeConversation?.agentRuns,
          additionalConversationIds: workspaceFallbackConversationIds,
        });
        if (!workspaceScope.workspaceConversationId) {
          return;
        }

        await shareConversationWorkspaceFile({
          conversationId: workspaceScope.workspaceConversationId,
          path: attachment.workspacePath,
          fallbackConversationIds: workspaceScope.fallbackConversationIds,
          dialogTitle: attachment.name || t('common.share'),
          mimeType: attachment.mimeType,
        });
        setChatError(null);
      } catch (error) {
        setChatError(error instanceof Error ? error.message : shareFileFailedMessage);
      }
    },
    [
      activeConversationId,
      activeConversation,
      conversations,
      setChatError,
      shareFileFailedMessage,
      t,
      workspaceFallbackConversationIds,
    ],
  );

  const handleOpenSubAgentDetails = useCallback(
    (snapshot: SubAgentSnapshot) => {
      setSelectedSubAgentSnapshot(snapshot);
    },
    [setSelectedSubAgentSnapshot],
  );

  const resolveMemoryFeedbackTarget = useCallback(
    (messageId: string, eventId: string): MemoryRetrievalFeedbackTarget | null => {
      if (!activeConversationId || activeConversation?.id !== activeConversationId) {
        return null;
      }
      const message = activeConversation.messages.find((candidate) => candidate.id === messageId);
      if (
        !message ||
        !hasCompleteFinalAssistantMetadata(message) ||
        message.assistantMetadata.memoryRetrievalEventId !== eventId
      ) {
        return null;
      }
      try {
        const workspaceTarget = resolveConversationWorkspaceTarget({
          conversationId: activeConversationId,
          conversations,
        });
        return {
          retrievalEventId: eventId,
          memoryConversationId: workspaceTarget.workspaceConversationId,
          sourceThreadId: activeConversationId,
          assistantMessageId: messageId,
        };
      } catch {
        return null;
      }
    },
    [activeConversation, activeConversationId, conversations],
  );

  const handleLoadMemoryFeedback = useCallback(
    async (messageId: string, eventId: string) => {
      const target = resolveMemoryFeedbackTarget(messageId, eventId);
      if (!target) return null;
      const result = await readExplicitMemoryRetrievalFeedback(target);
      return result.status === 'found' ? result.outcome : null;
    },
    [resolveMemoryFeedbackTarget],
  );

  const handleMemoryFeedback = useCallback(
    async (
      messageId: string,
      eventId: string,
      outcome: MemoryRetrievalFeedbackChoice,
    ): Promise<MemoryRetrievalFeedbackChoice> => {
      const target = resolveMemoryFeedbackTarget(messageId, eventId);
      if (!target) throw new Error('memory_retrieval_feedback_target_invalid');
      const result = await recordExplicitMemoryRetrievalFeedback({ target, outcome });
      if (
        result.status !== 'recorded' &&
        result.status !== 'updated' &&
        result.status !== 'unchanged'
      ) {
        throw new Error('memory_retrieval_feedback_not_recorded');
      }
      return result.outcome;
    },
    [resolveMemoryFeedbackTarget],
  );

  const handleShowEarlierMessages = useCallback(() => {
    setVisibleSourceMessageLimit((currentLimit) => currentLimit + CHAT_SOURCE_MESSAGE_PAGE_SIZE);
  }, [setVisibleSourceMessageLimit]);

  return {
    handleEdit,
    handleLoadMemoryFeedback,
    handleMemoryFeedback,
    handleOpenSubAgentDetails,
    handleShareWorkspaceFile,
    handleShowEarlierMessages,
    handleToggleSideThread,
    handleViewFiles,
  };
}
