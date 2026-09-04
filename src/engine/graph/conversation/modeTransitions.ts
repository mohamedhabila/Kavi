import type { ConversationMode } from '../../../types/conversation';
import { SUPER_AGENT_PERSONA_ID } from '../../../services/agents/personas';

/**
 * The mode a persona *suggests* for a conversation that does not have one yet —
 * used only when a persona is picked for a brand-new conversation or an explicit
 * persona switch (`useConversationGraphController.ts`). Mode is a conversation
 * property, not a persona flag: once a conversation exists, its persisted
 * `conversation.mode` is the runtime source of truth for every per-turn engine
 * decision (`graphOwnedRun`, the tool surface's conversation-mode gate,
 * `RequestUnderstandingRouting.mode`), never this function. In particular,
 * automatic mode escalation (`persistModeEscalation.ts`) does not call this: it
 * changes `conversation.mode` without touching `personaId`.
 */
export function resolveConversationModeForPersona(personaId: string): ConversationMode {
  return personaId === SUPER_AGENT_PERSONA_ID ? 'agentic' : 'chitchat';
}

/** Used only by the user-facing mode toggle to suggest a persona for the mode they picked. */
export function resolveConversationPersonaForMode(params: {
  conversationPersonaId?: string | null;
  nextMode: ConversationMode;
}): string {
  if (params.nextMode === 'agentic') {
    return SUPER_AGENT_PERSONA_ID;
  }

  const trimmedPersonaId = params.conversationPersonaId?.trim();
  if (trimmedPersonaId && trimmedPersonaId !== SUPER_AGENT_PERSONA_ID) {
    return trimmedPersonaId;
  }

  return 'default';
}
