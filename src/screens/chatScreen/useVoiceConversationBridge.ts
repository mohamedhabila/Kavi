import { useEffect } from 'react';
import type { RunChatOptions } from '../../engine/graph/foregroundRun/contracts';
import { useChatStore } from '../../store/useChatStore';
import { registerVoiceConversationHandler } from '../../services/voice/voiceConversationBridge';

type CanonicalSend = (text: string, runOptions?: RunChatOptions) => Promise<void>;

export function useVoiceConversationBridge(handleSend: CanonicalSend): void {
  useEffect(
    () =>
      registerVoiceConversationHandler(async (input, options) => {
        const beforeState = useChatStore.getState();
        const existingMessageIds = new Set(
          beforeState.conversations.flatMap((conversation) =>
            conversation.messages.map((message) => message.id),
          ),
        );

        await handleSend(input, options);

        const afterState = useChatStore.getState();
        const conversationId = afterState.activeConversationId;
        const conversation = conversationId
          ? afterState.conversations.find((candidate) => candidate.id === conversationId)
          : undefined;
        const assistantResponse = [...(conversation?.messages ?? [])]
          .reverse()
          .find(
            (message) =>
              !existingMessageIds.has(message.id) &&
              message.role === 'assistant' &&
              message.assistantMetadata?.kind !== 'intermediate' &&
              message.content.trim().length > 0,
          );

        return assistantResponse?.content ?? '';
      }),
    [handleSend],
  );
}
