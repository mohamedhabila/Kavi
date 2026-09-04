// ---------------------------------------------------------------------------
// Kavi — Conversation Runtime Mode Resolution
// ---------------------------------------------------------------------------
// Mode is a conversation property, not a persona flag. `useChatStore`'s persisted
// `conversation.mode` is the source of truth for every per-turn engine decision
// that used to be re-derived from `personaId === SUPER_AGENT_PERSONA_ID` instead —
// `graphOwnedRun`, `RequestUnderstandingRouting.mode`, and the tool surface's
// conversation-mode gate all read this value (directly, or through it).
//
// A sub-agent worker session is the one case with no persisted mode to read: it is
// never registered as a UI conversation (`subAgentOrchestratorRun.ts` runs it under
// its own `sessionId`, with no matching `useChatStore` entry), yet it still needs
// agentic authority to do delegated work at all. `personaIsSuperAgent` — how a
// worker is always launched — is the correct signal for exactly that case, and is
// consulted only when no tracked conversation exists.
// ---------------------------------------------------------------------------

import { useChatStore } from '../../../store/useChatStore';

export function resolveConversationStartsAgentic(params: {
  conversationId: string;
  personaIsSuperAgent: boolean;
}): boolean {
  const conversationId = params.conversationId.trim();
  if (!conversationId) {
    return params.personaIsSuperAgent;
  }

  const conversation = useChatStore
    .getState()
    .conversations.find((entry) => entry.id === conversationId);
  if (!conversation) {
    return params.personaIsSuperAgent;
  }

  return conversation.mode === 'agentic';
}
