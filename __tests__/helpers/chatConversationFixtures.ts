import { buildConversation } from '../../src/store/chatStoreConversationActions';
import { useChatStore } from '../../src/store/useChatStore';
import type { ConversationMode } from '../../src/types/conversation';

/**
 * Adds a conversation to the chat store, built as the app builds its one conversation. Tests
 * that check a write reaches only its own conversation add several here.
 */
export function addConversation(
  providerId: string,
  systemPrompt: string,
  modelOverride?: string,
  options?: { activate?: boolean; personaId?: string; mode?: ConversationMode },
): string {
  const conversation = buildConversation({
    providerId,
    systemPrompt,
    modelOverride,
    personaId: options?.personaId,
    mode: options?.mode,
  });
  useChatStore.setState((state) => ({
    conversations: [conversation, ...state.conversations],
    activeConversationId:
      options?.activate === false ? state.activeConversationId : conversation.id,
  }));
  return conversation.id;
}
