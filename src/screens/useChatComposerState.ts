import { useCallback, useMemo, useState } from 'react';
import { Attachment } from '../types/attachment';
import {
  type ComposerDraftState,
  getComposerDraftKey,
  isComposerDraftStateEmpty,
  normalizeComposerDraftState,
} from './chatComposerDrafts';

type UseChatComposerStateParams = {
  activeConversationId?: string | null;
  editingContent?: string;
  editingMessageId: string | null;
  setEditingContent: (value: string | undefined) => void;
};

export function useChatComposerState({
  activeConversationId,
  editingContent,
  editingMessageId,
  setEditingContent,
}: UseChatComposerStateParams): {
  activeComposerDraftKey: string;
  clearComposerDraft: (draftKey: string) => void;
  composerAttachments: Attachment[];
  composerText: string;
  handleComposerAttachmentsChange: (attachments: Attachment[]) => void;
  handleComposerTextChange: (value: string) => void;
} {
  const [composerDrafts, setComposerDrafts] = useState<Record<string, ComposerDraftState>>({});
  const activeComposerDraftKey = useMemo(
    () => getComposerDraftKey(activeConversationId),
    [activeConversationId],
  );
  const activeComposerDraft = useMemo(
    () => normalizeComposerDraftState(composerDrafts[activeComposerDraftKey]),
    [activeComposerDraftKey, composerDrafts],
  );

  const updateComposerDraft = useCallback((draftKey: string, nextDraft: ComposerDraftState) => {
    setComposerDrafts((currentDrafts) => {
      const normalizedDraft = normalizeComposerDraftState(nextDraft);
      if (isComposerDraftStateEmpty(normalizedDraft)) {
        if (!(draftKey in currentDrafts)) {
          return currentDrafts;
        }

        const remainingDrafts = { ...currentDrafts };
        delete remainingDrafts[draftKey];
        return remainingDrafts;
      }

      return {
        ...currentDrafts,
        [draftKey]: normalizedDraft,
      };
    });
  }, []);

  const clearComposerDraft = useCallback((draftKey: string) => {
    setComposerDrafts((currentDrafts) => {
      if (!(draftKey in currentDrafts)) {
        return currentDrafts;
      }

      const remainingDrafts = { ...currentDrafts };
      delete remainingDrafts[draftKey];
      return remainingDrafts;
    });
  }, []);

  const handleComposerTextChange = useCallback(
    (value: string) => {
      if (editingMessageId) {
        setEditingContent(value);
        return;
      }

      updateComposerDraft(activeComposerDraftKey, {
        text: value,
        attachments: activeComposerDraft.attachments,
      });
    },
    [
      activeComposerDraft.attachments,
      activeComposerDraftKey,
      editingMessageId,
      setEditingContent,
      updateComposerDraft,
    ],
  );

  const handleComposerAttachmentsChange = useCallback(
    (attachments: Attachment[]) => {
      if (editingMessageId) {
        return;
      }

      updateComposerDraft(activeComposerDraftKey, {
        text: activeComposerDraft.text,
        attachments,
      });
    },
    [activeComposerDraft.text, activeComposerDraftKey, editingMessageId, updateComposerDraft],
  );

  return {
    activeComposerDraftKey,
    clearComposerDraft,
    composerAttachments: editingMessageId ? [] : activeComposerDraft.attachments,
    composerText: editingMessageId ? (editingContent ?? '') : activeComposerDraft.text,
    handleComposerAttachmentsChange,
    handleComposerTextChange,
  };
}
