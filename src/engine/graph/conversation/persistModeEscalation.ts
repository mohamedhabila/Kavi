// ---------------------------------------------------------------------------
// Kavi — Persist Conversation Mode Escalation
// ---------------------------------------------------------------------------
// Applies a graph-owned escalation decision to durable conversation state so the
// switch survives the run: later user turns start agentic with the SuperAgent
// persona and its iteration budget, instead of hitting the same silent wall.
//
// The decision itself is made in `modeEscalation.ts` from structural signals only;
// this module performs no detection.
// ---------------------------------------------------------------------------

import { useChatStore } from '../../../store/useChatStore';
import { resolveConversationPersonaForMode } from './modeTransitions';

export function persistConversationModeEscalation(params: {
  conversationId: string;
  reason: string;
  blockedToolNames: ReadonlyArray<string>;
}): void {
  const conversationId = params.conversationId.trim();
  if (!conversationId) return;

  const store = useChatStore.getState();
  const conversation = store.conversations.find((entry) => entry.id === conversationId);
  if (!conversation || conversation.mode === 'agentic') return;

  store.updateModeInConversation(conversationId, 'agentic');
  // recordEvent renders the existing persona-switch marker in the transcript, so the
  // escalation is visible to the user rather than a silent capability change.
  store.updatePersonaInConversation(
    conversationId,
    resolveConversationPersonaForMode({
      conversationPersonaId: conversation.personaId,
      nextMode: 'agentic',
    }),
    { recordEvent: true },
  );
}
