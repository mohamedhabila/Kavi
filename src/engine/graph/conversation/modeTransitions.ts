import type { ConversationMode } from '../../../types/conversation';
import { SUPER_AGENT_PERSONA_ID } from '../../../services/agents/personas';

export function resolveConversationModeForPersona(personaId: string): ConversationMode {
  return personaId === SUPER_AGENT_PERSONA_ID ? 'agentic' : 'chitchat';
}

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
