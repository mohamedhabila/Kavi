// ---------------------------------------------------------------------------
// Kavi — Persist Conversation Mode Escalation
// ---------------------------------------------------------------------------
// Applies a graph-owned escalation decision to durable conversation state so the
// switch survives the run: later user turns start agentic instead of hitting the
// same silent wall.
//
// This is a capability escalation, not a persona swap: the conversation's `mode`
// moves to 'agentic' so the tool surface's authority gate opens, but `personaId` and
// the visible transcript are left untouched. A user mid-chitchat who asked for
// something that turned out to need a delegation or developer tool never sees an
// unexplained "switched to SuperAgent" marker — the persona they picked keeps
// answering, now with the wider authority the turn needed. `recordObservability` in
// `iterationExecution.ts` already logs `CONVERSATION_MODE_ESCALATED` for every
// escalation, so the change stays traceable without a user-visible event.
//
// The decision itself is made in `modeEscalation.ts` from structural signals only;
// this module performs no detection.
// ---------------------------------------------------------------------------

import { useChatStore } from '../../../store/useChatStore';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('ConversationModeEscalation');

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
  logger.debug(
    `conversationId=${conversationId}, reason=${params.reason}, blockedToolNames=${params.blockedToolNames.join(',')}`,
  );
}
