import type { StoreApi } from 'zustand';
import type { Message } from '../types/message';
import { generateId } from '../utils/id';
import { generateConversationTitle, isPlaceholderTitle } from '../utils/conversation';
import { findMatchingToolCallIndexWithinMessage } from '../utils/toolCallMatching';
import { extractToolCallAttachments, mergeAttachmentLists } from '../utils/messageAttachments';
import { normalizeLegacyAssistantMessages } from '../utils/assistantMessageMetadata';
import { requestChatStorePersistenceCheckpoint } from './chatStorePersistence';
import {
  areAssistantMessageMetadataEqual,
  areAttachmentsEqual,
  areToolCallsEqual,
  capMessages,
  updateConversationById,
  updateConversationMessageById,
} from './chatStoreHelpers';
import type { ChatState } from './chatStoreTypes';

type ChatStoreSet = StoreApi<ChatState>['setState'];

export function createMessageStoreActions(
  set: ChatStoreSet,
): Pick<
  ChatState,
  | 'addMessage'
  | 'applyConversationCompaction'
  | 'updateMessage'
  | 'updateMessageEnrichedContent'
  | 'updateMessageReasoning'
  | 'updateMessageProviderReplay'
  | 'updateMessageAssistantMetadata'
  | 'updateMessageEffect'
  | 'editMessage'
  | 'setLoading'
  | 'addToolCall'
  | 'updateToolCallStatus'
> {
  return {
    addMessage: (conversationId, message) => {
      set((state) => ({
        conversations: state.conversations.map((c) => {
          if (c.id !== conversationId) return c;
          const newMessage: Message = {
            ...message,
            id: message.id || generateId(),
            timestamp: Date.now(),
          };
          const shouldAutoTitle =
            message.role === 'user' && !!message.content?.trim() && isPlaceholderTitle(c.title);
          return {
            ...c,
            title: shouldAutoTitle ? generateConversationTitle(message.content) : c.title,
            messages: capMessages([...c.messages, newMessage]),
            updatedAt: Date.now(),
          };
        }),
      }));
      requestChatStorePersistenceCheckpoint();
    },

    applyConversationCompaction: (conversationId, messages) => {
      const nextMessages = capMessages(normalizeLegacyAssistantMessages(messages));

      set((state) => {
        const conversations = updateConversationById(
          state.conversations,
          conversationId,
          (conversation) => {
            if (nextMessages.length === 0) {
              return conversation;
            }

            return {
              ...conversation,
              messages: nextMessages,
              updatedAt: Date.now(),
            };
          },
        );

        return conversations ? { conversations } : state;
      });

      requestChatStorePersistenceCheckpoint();
    },

    updateMessage: (conversationId, messageId, content) =>
      set((state) => {
        const conversations = updateConversationMessageById(
          state.conversations,
          conversationId,
          messageId,
          (message) => (message.content === content ? message : { ...message, content }),
        );
        return conversations ? { conversations } : state;
      }),

    updateMessageEnrichedContent: (conversationId, messageId, enrichedContent) =>
      set((state) => {
        const conversations = updateConversationMessageById(
          state.conversations,
          conversationId,
          messageId,
          (message) =>
            message.enrichedContent === enrichedContent ? message : { ...message, enrichedContent },
        );
        return conversations ? { conversations } : state;
      }),

    updateMessageReasoning: (conversationId, messageId, reasoning) =>
      set((state) => {
        const conversations = updateConversationMessageById(
          state.conversations,
          conversationId,
          messageId,
          (message) => (message.reasoning === reasoning ? message : { ...message, reasoning }),
        );
        return conversations ? { conversations } : state;
      }),

    updateMessageProviderReplay: (conversationId, messageId, providerReplay) =>
      set((state) => {
        const conversations = updateConversationMessageById(
          state.conversations,
          conversationId,
          messageId,
          (message) =>
            message.providerReplay === providerReplay ? message : { ...message, providerReplay },
        );
        return conversations ? { conversations } : state;
      }),

    updateMessageAssistantMetadata: (conversationId, messageId, assistantMetadata) =>
      set((state) => {
        const conversations = updateConversationMessageById(
          state.conversations,
          conversationId,
          messageId,
          (message) =>
            areAssistantMessageMetadataEqual(message.assistantMetadata, assistantMetadata)
              ? message
              : { ...message, assistantMetadata },
        );
        return conversations ? { conversations } : state;
      }),

    updateMessageEffect: (conversationId, messageId, effectId) =>
      set((state) => {
        const conversations = updateConversationMessageById(
          state.conversations,
          conversationId,
          messageId,
          (message) => (message.effectId === effectId ? message : { ...message, effectId }),
        );
        return conversations ? { conversations } : state;
      }),

    editMessage: (conversationId, messageId, newContent) => {
      set((state) => ({
        conversations: state.conversations.map((c) => {
          if (c.id !== conversationId) return c;
          const index = c.messages.findIndex((m) => m.id === messageId);
          if (index === -1) return c;
          const rewindTimestamp = c.messages[index]?.timestamp ?? Date.now();
          const editTimestamp = Date.now();
          const newMessages = c.messages.slice(0, index + 1).map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  content: newContent,
                  enrichedContent: undefined,
                  timestamp: editTimestamp,
                }
              : m,
          );
          const nextLogs = (c.logs ?? []).filter((entry) => entry.timestamp < rewindTimestamp);
          const nextAgentRuns = (c.agentRuns ?? []).filter(
            (run) => run.createdAt < rewindTimestamp,
          );
          const nextActiveAgentRunId =
            c.activeAgentRunId &&
            nextAgentRuns.some((run) => run.id === c.activeAgentRunId && run.status === 'running')
              ? c.activeAgentRunId
              : undefined;

          return {
            ...c,
            messages: newMessages,
            logs: nextLogs,
            agentRuns: nextAgentRuns,
            activeAgentRunId: nextActiveAgentRunId,
            usage: c.usage,
            updatedAt: editTimestamp,
          };
        }),
      }));
      requestChatStorePersistenceCheckpoint();
    },

    setLoading: (loading) =>
      set((state) => (state.isLoading === loading ? state : { isLoading: loading })),

    addToolCall: (conversationId, messageId, toolCall) =>
      set((state) => {
        const conversations = updateConversationMessageById(
          state.conversations,
          conversationId,
          messageId,
          (message) => {
            const existingToolCalls = message.toolCalls || [];
            const existingIndex = findMatchingToolCallIndexWithinMessage(
              existingToolCalls,
              toolCall,
            );
            const existingToolCall =
              existingIndex >= 0 ? existingToolCalls[existingIndex] : undefined;
            const now = Date.now();
            const normalizedToolCall = {
              ...existingToolCall,
              ...toolCall,
              startedAt: toolCall.startedAt ?? existingToolCall?.startedAt ?? now,
              updatedAt: toolCall.updatedAt ?? existingToolCall?.updatedAt ?? now,
              completedAt: toolCall.completedAt ?? existingToolCall?.completedAt,
              progressText: toolCall.progressText ?? existingToolCall?.progressText,
              result: toolCall.result ?? existingToolCall?.result,
              error: toolCall.error ?? existingToolCall?.error,
            };

            const incomingAttachments = extractToolCallAttachments(normalizedToolCall);
            const nextAttachments = incomingAttachments?.length
              ? mergeAttachmentLists(message.attachments, incomingAttachments)
              : message.attachments;
            const hasAttachmentChange = !areAttachmentsEqual(message.attachments, nextAttachments);
            const hasToolCallChange =
              existingIndex < 0 || !areToolCallsEqual(existingToolCall, normalizedToolCall);

            if (!hasToolCallChange && !hasAttachmentChange) {
              return message;
            }

            const nextToolCalls = hasToolCallChange
              ? existingIndex >= 0
                ? [
                    ...existingToolCalls.slice(0, existingIndex),
                    normalizedToolCall,
                    ...existingToolCalls.slice(existingIndex + 1),
                  ]
                : [...existingToolCalls, normalizedToolCall]
              : existingToolCalls;

            return {
              ...message,
              ...(hasAttachmentChange ? { attachments: nextAttachments } : {}),
              ...(hasToolCallChange ? { toolCalls: nextToolCalls } : {}),
            };
          },
        );
        return conversations ? { conversations } : state;
      }),

    updateToolCallStatus: (conversationId, messageId, toolCallId, status, payload) =>
      set((state) => {
        const conversations = updateConversationMessageById(
          state.conversations,
          conversationId,
          messageId,
          (message) => {
            if (!message.toolCalls?.length) {
              return message;
            }

            const toolCallIndex = message.toolCalls.findIndex(
              (toolCall) => toolCall.id === toolCallId,
            );
            if (toolCallIndex < 0) {
              return message;
            }

            const currentToolCall = message.toolCalls[toolCallIndex];
            const now = Date.now();
            const nextStartedAt = currentToolCall.startedAt ?? now;
            const nextCompletedAt =
              status === 'completed' || status === 'failed'
                ? (payload?.completedAt ?? currentToolCall.completedAt ?? now)
                : currentToolCall.completedAt;
            const nextProgressText = payload?.progressText ?? currentToolCall.progressText;
            const nextResult =
              payload?.result ?? (status === 'failed' ? undefined : currentToolCall.result);
            const nextError =
              payload?.error ?? (status !== 'failed' ? undefined : currentToolCall.error);
            const hasToolCallChange =
              currentToolCall.status !== status ||
              currentToolCall.startedAt !== nextStartedAt ||
              currentToolCall.completedAt !== nextCompletedAt ||
              currentToolCall.progressText !== nextProgressText ||
              currentToolCall.result !== nextResult ||
              currentToolCall.error !== nextError;

            const nextToolCall = hasToolCallChange
              ? {
                  ...currentToolCall,
                  status,
                  updatedAt: now,
                  startedAt: nextStartedAt,
                  completedAt: nextCompletedAt,
                  progressText: nextProgressText,
                  result: nextResult,
                  error: nextError,
                }
              : currentToolCall;

            const incomingAttachments = extractToolCallAttachments(nextToolCall);
            const nextAttachments = incomingAttachments?.length
              ? mergeAttachmentLists(message.attachments, incomingAttachments)
              : message.attachments;
            const hasAttachmentChange = !areAttachmentsEqual(message.attachments, nextAttachments);

            if (!hasToolCallChange && !hasAttachmentChange) {
              return message;
            }

            const nextToolCalls = hasToolCallChange
              ? [
                  ...message.toolCalls.slice(0, toolCallIndex),
                  nextToolCall,
                  ...message.toolCalls.slice(toolCallIndex + 1),
                ]
              : message.toolCalls;

            return {
              ...message,
              ...(hasAttachmentChange ? { attachments: nextAttachments } : {}),
              ...(hasToolCallChange ? { toolCalls: nextToolCalls } : {}),
            };
          },
        );
        return conversations ? { conversations } : state;
      }),
  };
}
