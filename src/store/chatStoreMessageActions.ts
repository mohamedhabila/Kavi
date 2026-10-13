import type { StoreApi } from 'zustand';
import type { Message, ToolCall } from '../types/message';
import { generateId } from '../utils/id';
import { findMatchingToolCallIndexWithinMessage } from '../utils/toolCallMatching';
import {
  cloneAttachments,
  extractToolCallAttachments,
  mergeAttachmentLists,
} from '../utils/messageAttachments';
import { requestChatStorePersistenceCheckpoint } from './chatStorePersistence';
import {
  areAssistantMessageMetadataEqual,
  areAttachmentsEqual,
  areToolCallsEqual,
  updateConversationById,
  updateConversationMessageById,
} from './chatStoreHelpers';
import type { ChatState, RewindUserMessageForResendResult } from './chatStoreTypes';
import { appendToolEffectReceipt } from '../utils/toolEffectReceipt';
import { deleteMemoryTurnsOpenedBy } from '../services/memory/core/memoryTurnsStore';
import { createLogger } from '../utils/logger';
import {
  getProtectedExecutionMessageIds,
  preserveProtectedExecutionMessages,
} from './chatExecutionMessageProtection';
import { selectDurableCompactionMessages } from './chatConversationCompaction';
import { archiveLeavingMessages } from './chatPersistence';
import { applyHistoryWindow } from './conversationHistoryWindow';
import { resolveRewindUserMessageEligibility } from './chatStoreUserMessageRewind';

type ChatStoreSet = StoreApi<ChatState>['setState'];

const logger = createLogger('chat-store.messages');

function forgetRewoundTurns(userMessageIds: string[]): void {
  try {
    deleteMemoryTurnsOpenedBy(userMessageIds);
  } catch (error) {
    // Memory is never allowed to fail a resend; the stale rounds only lose relevance.
    logger.warn('Could not remove rewound turns from memory.', { error: String(error) });
  }
}

function stripUntrustedToolEffectReceipts(toolCall: ToolCall): ToolCall {
  const sanitized = { ...toolCall };
  delete sanitized.effectReceipts;
  return sanitized;
}

export function createMessageStoreActions(
  set: ChatStoreSet,
): Pick<
  ChatState,
  | 'addMessage'
  | 'applyConversationCompaction'
  | 'resetConversationContext'
  | 'updateMessage'
  | 'updateMessageEnrichedContent'
  | 'updateMessageAttachments'
  | 'updateMessageReasoning'
  | 'updateMessageProviderReplay'
  | 'updateMessageAssistantMetadata'
  | 'updateMessageEffect'
  | 'rewindUserMessageForResend'
  | 'setLoading'
  | 'addToolCall'
  | 'updateToolCallStatus'
> {
  return {
    addMessage: (conversationId, message) => {
      set((state) => ({
        conversations: state.conversations.map((c) => {
          if (c.id !== conversationId) return c;
          const timestamp = message.timestamp ?? Date.now();
          const newMessage: Message = {
            ...message,
            id: message.id || generateId(),
            timestamp,
            ...(message.toolCalls
              ? { toolCalls: message.toolCalls.map(stripUntrustedToolEffectReceipts) }
              : {}),
          };
          const nextMessages = applyHistoryWindow(
            c.id,
            [...c.messages, newMessage],
            getProtectedExecutionMessageIds(c),
          );
          return {
            ...c,
            messages: nextMessages,
            updatedAt: timestamp,
          };
        }),
      }));
      requestChatStorePersistenceCheckpoint();
    },

    applyConversationCompaction: (conversationId, messages) => {
      set((state) => {
        const conversations = updateConversationById(
          state.conversations,
          conversationId,
          (conversation) => {
            const compacted = preserveProtectedExecutionMessages(
              conversation,
              selectDurableCompactionMessages(conversation, messages),
            );
            if (compacted.length === 0) {
              return conversation;
            }
            const nextMessages = applyHistoryWindow(
              conversation.id,
              compacted,
              getProtectedExecutionMessageIds(conversation),
            );
            // The rounds a summary replaced leave the live history, not the transcript.
            const keptIds = new Set(nextMessages.map((message) => message.id));
            archiveLeavingMessages(
              conversation.id,
              conversation.messages.filter((message) => !keptIds.has(message.id)),
            );

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

    resetConversationContext: (conversationId) => {
      let reset = false;
      set((state) => {
        const conversations = updateConversationById(
          state.conversations,
          conversationId,
          (conversation) => {
            const protectedMessageIds = getProtectedExecutionMessageIds(conversation);
            const leaving = conversation.messages.filter(
              (message) => !protectedMessageIds.has(message.id),
            );
            if (leaving.length === 0) return conversation;
            archiveLeavingMessages(conversation.id, leaving);
            reset = true;
            return {
              ...conversation,
              messages: conversation.messages.filter((message) =>
                protectedMessageIds.has(message.id),
              ),
              updatedAt: Date.now(),
            };
          },
        );
        return conversations ? { conversations } : state;
      });
      if (reset) requestChatStorePersistenceCheckpoint();
      return reset;
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

    updateMessageAttachments: (conversationId, messageId, attachments) =>
      set((state) => {
        const conversations = updateConversationMessageById(
          state.conversations,
          conversationId,
          messageId,
          (message) =>
            areAttachmentsEqual(message.attachments, attachments)
              ? message
              : { ...message, attachments: cloneAttachments(attachments) },
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

    rewindUserMessageForResend: (conversationId, messageId, newContent) => {
      let result: RewindUserMessageForResendResult = {
        status: 'rejected',
        reason: 'conversation_unavailable',
      };
      let shouldCheckpoint = false;
      let removedUserMessageIds: string[] = [];

      set((state) => {
        const eligibility = resolveRewindUserMessageEligibility({
          conversations: state.conversations,
          conversationId,
          messageId,
        });
        if (eligibility.status === 'rejected') {
          result = eligibility;
          return state;
        }
        const { conversationIndex, messageIndex } = eligibility;
        const conversation = state.conversations[conversationIndex];
        const message = conversation.messages[messageIndex];

        const existingMessageIds = new Set(conversation.messages.map((candidate) => candidate.id));
        let replacementMessageId = generateId();
        while (existingMessageIds.has(replacementMessageId)) {
          replacementMessageId = generateId();
        }

        const rewindTimestamp = message.timestamp;
        const replacementTimestamp = Date.now();
        // A resent message opens a new turn, even one that had steered a run.
        const {
          enrichedContent: _discardedEnrichedContent,
          steerOfRunId: _discardedSteerOfRunId,
          ...preservedMessage
        } = message;
        const replacementMessage: Message = {
          ...preservedMessage,
          id: replacementMessageId,
          content: newContent,
          timestamp: replacementTimestamp,
        };
        const nextMessages = [...conversation.messages.slice(0, messageIndex), replacementMessage];
        removedUserMessageIds = conversation.messages
          .slice(messageIndex)
          .flatMap((removed) => (removed.role === 'user' ? [removed.id] : []));

        const nextLogs = (conversation.logs ?? []).filter(
          (entry) => entry.timestamp < rewindTimestamp,
        );
        const nextAgentRuns = (conversation.agentRuns ?? []).filter(
          (run) => run.createdAt < rewindTimestamp,
        );
        const nextActiveAgentRunId =
          conversation.activeAgentRunId &&
          nextAgentRuns.some(
            (run) => run.id === conversation.activeAgentRunId && run.status === 'running',
          )
            ? conversation.activeAgentRunId
            : undefined;

        const conversations = [...state.conversations];
        conversations[conversationIndex] = {
          ...conversation,
          messages: nextMessages,
          logs: nextLogs,
          agentRuns: nextAgentRuns,
          activeAgentRunId: nextActiveAgentRunId,
          usage: conversation.usage,
          updatedAt: replacementTimestamp,
        };
        result = {
          status: 'applied',
          replacedMessageId: messageId,
          replacementMessageId,
        };
        shouldCheckpoint = true;
        return { conversations };
      });

      if (shouldCheckpoint) requestChatStorePersistenceCheckpoint();
      // The rewound turns no longer happened, so they leave the past-turn index too.
      if (removedUserMessageIds.length > 0) forgetRewoundTurns(removedUserMessageIds);
      return result;
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
            const incomingToolCall = stripUntrustedToolEffectReceipts(toolCall);
            const normalizedToolCall = {
              ...existingToolCall,
              ...incomingToolCall,
              startedAt: incomingToolCall.startedAt ?? existingToolCall?.startedAt ?? now,
              updatedAt: incomingToolCall.updatedAt ?? existingToolCall?.updatedAt ?? now,
              completedAt: incomingToolCall.completedAt ?? existingToolCall?.completedAt,
              progressText: incomingToolCall.progressText ?? existingToolCall?.progressText,
              result: incomingToolCall.result ?? existingToolCall?.result,
              error: incomingToolCall.error ?? existingToolCall?.error,
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
            const nextEffectReceipts = payload?.effectReceipt
              ? appendToolEffectReceipt(currentToolCall.effectReceipts, payload.effectReceipt, {
                  toolCallId: currentToolCall.id,
                  toolName: currentToolCall.name,
                })
              : currentToolCall.effectReceipts;
            const hasToolCallChange =
              currentToolCall.status !== status ||
              currentToolCall.startedAt !== nextStartedAt ||
              currentToolCall.completedAt !== nextCompletedAt ||
              currentToolCall.progressText !== nextProgressText ||
              currentToolCall.result !== nextResult ||
              currentToolCall.error !== nextError ||
              currentToolCall.effectReceipts !== nextEffectReceipts;

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
                  effectReceipts: nextEffectReceipts,
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
