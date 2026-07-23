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
  composerExactText: boolean;
  composerText: string;
  handleComposerAttachmentsChange: (attachments: Attachment[]) => void;
  handleComposerExactTextChange: (exactText: boolean) => void;
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
        exactText: activeComposerDraft.exactText,
      });
    },
    [
      activeComposerDraft.attachments,
      activeComposerDraft.exactText,
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
        exactText: activeComposerDraft.exactText,
      });
    },
    [
      activeComposerDraft.exactText,
      activeComposerDraft.text,
      activeComposerDraftKey,
      editingMessageId,
      updateComposerDraft,
    ],
  );

  const handleComposerExactTextChange = useCallback(
    (exactText: boolean) => {
      updateComposerDraft(activeComposerDraftKey, {
        text: activeComposerDraft.text,
        attachments: activeComposerDraft.attachments,
        exactText,
      });
    }, [activeComposerDraft, activeComposerDraftKey, updateComposerDraft],
  );

  return {
    activeComposerDraftKey,
    clearComposerDraft,
    composerAttachments: editingMessageId ? [] : activeComposerDraft.attachments,
    composerExactText: activeComposerDraft.exactText,
    composerText: editingMessageId ? (editingContent ?? '') : activeComposerDraft.text,
    handleComposerAttachmentsChange,
    handleComposerExactTextChange,
    handleComposerTextChange,
  };
}
