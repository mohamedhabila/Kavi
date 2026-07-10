import { resolveConversationPersonaForMode } from '../conversation/modeTransitions';
import type { Conversation, ConversationMode } from '../../../types/conversation';

export type ForegroundConversationExecutionContext = {
  mode: ConversationMode;
  personaId: string;
};

export function resolveForegroundConversationExecutionContext(params: {
  conversation?: Conversation;
  defaultConversationMode: ConversationMode;
}): ForegroundConversationExecutionContext {
  const mode = params.conversation?.mode ?? params.defaultConversationMode;

  return {
    mode,
    personaId: resolveConversationPersonaForMode({
      conversationPersonaId: params.conversation?.personaId,
      nextMode: mode,
    }),
  };
}
