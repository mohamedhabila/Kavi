import { useCallback, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { useTranslation } from '../../i18n/useTranslation';
import { deleteConversationStoppingWork } from '../../services/conversationDeletion';
import { hasConversationWork } from '../../services/conversationWorkStop';
import { useChatStore } from '../../store/useChatStore';
import type { Conversation } from '../../types/conversation';
import { createLogger } from '../../utils/logger';
import type { ConversationAction } from './ConversationActionsSheet';

const logger = createLogger('ConversationActions');

type ActionTarget = { id: string; title: string };

/**
 * Rename and delete for one conversation at a time: an actions sheet, a rename dialog, and
 * a confirmed delete that stops any work still running in the conversation first.
 */
export function useConversationActions() {
  const { t } = useTranslation();
  const renameConversation = useChatStore((state) => state.renameConversation);
  const [target, setTarget] = useState<ActionTarget | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(() => new Set());
  // iOS cannot present an alert or another modal while a modal is still animating out, so
  // the chosen action waits for the sheet's dismissal there; Android runs it immediately.
  const pendingActionRef = useRef<ConversationAction | null>(null);

  const titleOf = useCallback(
    (conversation: Conversation) => conversation.title.trim() || t('nav.newConversation'),
    [t],
  );

  const openActions = useCallback(
    (conversation: Conversation) => {
      pendingActionRef.current = null;
      setTarget({ id: conversation.id, title: titleOf(conversation) });
      setSheetVisible(true);
    },
    [titleOf],
  );

  const closeSheet = useCallback(() => {
    pendingActionRef.current = null;
    setSheetVisible(false);
  }, []);

  const performDelete = useCallback(
    async (conversationId: string) => {
      setDeletingIds((current) => new Set(current).add(conversationId));
      try {
        await deleteConversationStoppingWork(conversationId);
      } catch (error: unknown) {
        logger.warn('Could not delete conversation', {
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        });
        Alert.alert(t('common.error'), t('conversationActions.deleteFailed'));
      } finally {
        setDeletingIds((current) => {
          const next = new Set(current);
          next.delete(conversationId);
          return next;
        });
      }
    },
    [t],
  );

  const confirmDelete = useCallback(
    (actionTarget: ActionTarget) => {
      const conversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === actionTarget.id);
      if (!conversation) return;
      const message = t('conversationActions.deleteConfirmMessage', { title: actionTarget.title });
      Alert.alert(
        t('conversationActions.deleteConfirmTitle'),
        hasConversationWork(conversation)
          ? `${message}\n\n${t('conversationActions.deleteWhileWorking')}`
          : message,
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('conversationActions.delete'),
            style: 'destructive',
            onPress: () => {
              void performDelete(actionTarget.id);
            },
          },
        ],
        { cancelable: true },
      );
    },
    [performDelete, t],
  );

  const runAction = useCallback(
    (action: ConversationAction) => {
      if (!target) return;
      if (action === 'rename') {
        setRenameVisible(true);
      } else {
        confirmDelete(target);
      }
    },
    [confirmDelete, target],
  );

  const chooseAction = useCallback(
    (action: ConversationAction) => {
      setSheetVisible(false);
      if (Platform.OS === 'ios') {
        pendingActionRef.current = action;
        return;
      }
      runAction(action);
    },
    [runAction],
  );

  const handleSheetDismissed = useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action) runAction(action);
  }, [runAction]);

  const saveRename = useCallback(
    (title: string) => {
      if (target) renameConversation(target.id, title);
      setRenameVisible(false);
    },
    [renameConversation, target],
  );

  const cancelRename = useCallback(() => setRenameVisible(false), []);

  return {
    target,
    sheetVisible,
    renameVisible,
    deletingIds,
    openActions,
    closeSheet,
    chooseAction,
    handleSheetDismissed,
    saveRename,
    cancelRename,
  };
}
