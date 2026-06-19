import type { Attachment } from '../types/attachment';

export type ComposerDraftState = {
  text: string;
  attachments: Attachment[];
};

const NEW_CONVERSATION_DRAFT_KEY = '__new_conversation__';

export function getComposerDraftKey(conversationId?: string | null): string {
  return conversationId || NEW_CONVERSATION_DRAFT_KEY;
}

export function normalizeComposerDraftState(
  draft?: Partial<ComposerDraftState>,
): ComposerDraftState {
  return {
    text: typeof draft?.text === 'string' ? draft.text : '',
    attachments: Array.isArray(draft?.attachments) ? draft.attachments : [],
  };
}

export function isComposerDraftStateEmpty(draft: ComposerDraftState): boolean {
  return draft.text.length === 0 && draft.attachments.length === 0;
}
