import type { Conversation } from '../../types/conversation';
import { DEFAULT_PERSONA_ID } from './personas';
import { getPersona } from './registry';

/**
 * What the conversation is called: the focus memory extraction named for it, else the name
 * of the persona the user talks to, the way a messaging app shows a contact's name.
 */
export function resolveConversationDisplayTitle(
  conversation: Pick<Conversation, 'title' | 'personaId'> | undefined,
): string {
  const focus = conversation?.title.trim();
  if (focus) return focus;
  return (
    getPersona(conversation?.personaId ?? DEFAULT_PERSONA_ID)?.name ??
    getPersona(DEFAULT_PERSONA_ID)?.name ??
    ''
  );
}
