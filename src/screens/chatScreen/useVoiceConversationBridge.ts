import { useEffect } from 'react';
import type { RunChatOptions } from '../../engine/graph/foregroundRun/contracts';
import { useChatStore } from '../../store/useChatStore';
import { registerVoiceConversationHandler } from '../../services/voice/voiceConversationBridge';
import type { StreamingDraftListener } from '../useStreamingDrafts';

type CanonicalSend = (text: string, runOptions?: RunChatOptions) => Promise<void>;

const REPLY_PART_SEPARATOR = '\n\n';

/**
 * Runs voice turns through the conversation's own send. The reply's text is reported as it
 * streams: every assistant message the turn writes (a word before a tool, then the answer),
 * in order.
 */
export function useVoiceConversationBridge(
  handleSend: CanonicalSend,
  subscribeToStreamingDrafts: (listener: StreamingDraftListener) => () => void,
): void {
  useEffect(
    () =>
      registerVoiceConversationHandler(async (input, options) => {
        const beforeState = useChatStore.getState();
        const existingMessageIds = new Set(
          beforeState.conversations.flatMap((conversation) =>
            conversation.messages.map((message) => message.id),
          ),
        );
        const replyParts = new Map<string, string>();
        const replySoFar = () =>
          [...replyParts.values()].filter((part) => part.trim()).join(REPLY_PART_SEPARATOR);

        const unsubscribe = subscribeToStreamingDrafts((messageId, draft) => {
          if (existingMessageIds.has(messageId) || typeof draft?.content !== 'string') return;
          replyParts.set(messageId, draft.content);
          options?.onReplyText?.(replySoFar());
        });
        try {
          await handleSend(
            input,
            options?.additionalSystemPrompt
              ? { additionalSystemPrompt: options.additionalSystemPrompt }
              : undefined,
          );
        } finally {
          unsubscribe();
        }

        const afterState = useChatStore.getState();
        const conversationId = afterState.activeConversationId;
        const conversation = conversationId
          ? afterState.conversations.find((candidate) => candidate.id === conversationId)
          : undefined;
        const turnReplies = (conversation?.messages ?? []).filter(
          (message) =>
            !existingMessageIds.has(message.id) &&
            message.role === 'assistant' &&
            message.content.trim().length > 0,
        );
        // What was saved is what the turn said; it replaces the streamed drafts in place.
        for (const message of turnReplies) replyParts.set(message.id, message.content);
        const finalReply = [...turnReplies]
          .reverse()
          .find((message) => message.assistantMetadata?.kind !== 'intermediate');

        return { response: finalReply?.content ?? '', spokenText: replySoFar() };
      }),
    [handleSend, subscribeToStreamingDrafts],
  );
}
