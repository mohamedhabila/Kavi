import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import { shareConversationWorkspaceFile } from '../../services/share/localShare';
import type { Attachment } from '../../types/attachment';
import type { Conversation } from '../../types/conversation';
import type { Message } from '../../types/message';
import { CHAT_SOURCE_MESSAGE_PAGE_SIZE } from '../chatScreenDisplayState';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

type SubAgentSnapshot = NonNullable<Message['subAgentEvent']>['snapshot'];

type UseChatScreenUiCallbacksParams = {
  activeConversation?: Conversation;
  activeConversationId: string | null;
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
  handleOpenSubAgentDetails: (snapshot: SubAgentSnapshot) => void;
  handleShareWorkspaceFile: (attachment: Attachment) => Promise<void>;
  handleShowEarlierMessages: () => void;
  handleToggleSideThread: () => void;
  handleViewFiles: (path?: string) => void;
} {
  const {
    activeConversation,
    activeConversationId,
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
      discardSideThread?.(activeConversation.id);
      return;
    }

    createSideThread?.(activeConversation.id);
  }, [activeConversation, createSideThread, discardSideThread]);

  const handleShareWorkspaceFile = useCallback(
    async (attachment: Attachment) => {
      if (!activeConversationId || !attachment.workspacePath) {
        return;
      }

      try {
        await shareConversationWorkspaceFile({
          conversationId: activeConversationId,
          path: attachment.workspacePath,
          fallbackConversationIds: workspaceFallbackConversationIds,
          dialogTitle: attachment.name || t('common.share'),
          mimeType: attachment.mimeType,
        });
        setChatError(null);
      } catch (error) {
        setChatError(error instanceof Error ? error.message : shareFileFailedMessage);
      }
    },
    [activeConversationId, setChatError, shareFileFailedMessage, t, workspaceFallbackConversationIds],
  );

  const handleOpenSubAgentDetails = useCallback(
    (snapshot: SubAgentSnapshot) => {
      setSelectedSubAgentSnapshot(snapshot);
    },
    [setSelectedSubAgentSnapshot],
  );

  const handleShowEarlierMessages = useCallback(() => {
    setVisibleSourceMessageLimit((currentLimit) => currentLimit + CHAT_SOURCE_MESSAGE_PAGE_SIZE);
  }, [setVisibleSourceMessageLimit]);

  return {
    handleEdit,
    handleOpenSubAgentDetails,
    handleShareWorkspaceFile,
    handleShowEarlierMessages,
    handleToggleSideThread,
    handleViewFiles,
  };
}
