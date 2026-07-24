import { useEffect, useRef } from 'react';

export interface PreparedChatDraft {
  requestId: string;
  conversationId: string;
  source: 'delegated-work-retry';
  text: string;
}

export type PreparedChatDraftOutcome = 'applied' | 'preserved_existing';

function resolvePreparedChatDraft(value: unknown): PreparedChatDraft | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<PreparedChatDraft>;
  if (
    typeof candidate.requestId !== 'string' ||
    candidate.requestId.trim().length === 0 ||
    typeof candidate.conversationId !== 'string' ||
    candidate.conversationId.trim().length === 0 ||
    candidate.source !== 'delegated-work-retry' ||
    typeof candidate.text !== 'string' ||
    candidate.text.trim().length === 0
  ) {
    return null;
  }

  return {
    requestId: candidate.requestId.trim(),
    conversationId: candidate.conversationId.trim(),
    source: candidate.source,
    text: candidate.text,
  };
}

/** Applies a navigation-provided draft once without replacing a user's existing composition. */
export function usePreparedChatDraft(params: {
  activeConversationId?: string | null;
  composerText: string;
  editingMessageId: string | null;
  onApplyText: (text: string) => void;
  onConsumed: (requestId: string, outcome: PreparedChatDraftOutcome) => void;
  preparedDraft: unknown;
}): void {
  const consumedRequestIdsRef = useRef(new Set<string>());
  const {
    activeConversationId,
    composerText,
    editingMessageId,
    onApplyText,
    onConsumed,
    preparedDraft,
  } = params;

  useEffect(() => {
    const draft = resolvePreparedChatDraft(preparedDraft);
    if (!draft || draft.conversationId !== activeConversationId) return;
    if (consumedRequestIdsRef.current.has(draft.requestId)) return;

    consumedRequestIdsRef.current.add(draft.requestId);
    const canApply = editingMessageId === null && composerText.length === 0;
    if (canApply) onApplyText(draft.text);
    onConsumed(draft.requestId, canApply ? 'applied' : 'preserved_existing');
  }, [
    activeConversationId,
    composerText,
    editingMessageId,
    onApplyText,
    onConsumed,
    preparedDraft,
  ]);
}
