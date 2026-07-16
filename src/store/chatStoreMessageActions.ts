import type { StoreApi } from 'zustand';
import type { Message, ToolCall } from '../types/message';
import { generateId } from '../utils/id';
import { generateConversationTitle, isPlaceholderTitle } from '../utils/conversation';
import { findMatchingToolCallIndexWithinMessage } from '../utils/toolCallMatching';
import { extractToolCallAttachments, mergeAttachmentLists } from '../utils/messageAttachments';
import { mergeAssistantMessageMetadata } from '../utils/assistantMessageMetadata';
import { requestChatStorePersistenceCheckpoint } from './chatStorePersistence';
import {
  areAssistantMessageMetadataEqual,
  areAttachmentsEqual,
  areToolCallsEqual,
  capMessages,
  updateConversationById,
  updateConversationMessageById,
} from './chatStoreHelpers';
import type {
  ChatState,
  RewindUserMessageForResendResult,
  TransitionMessageMemoryPublicationResult,
} from './chatStoreTypes';
import { appendToolEffectReceipt } from '../utils/toolEffectReceipt';
import {
  isEligibleMessageMemoryPublicationSource,
  normalizeMessageMemoryPublication,
  resolveMessageMemoryPublicationTransition,
} from '../utils/messageMemoryPublication';
import {
  assertConversationCompactionMemoryPublicationSourcesSafe,
  assertMemoryPublicationLockedSourcesUnchanged,
  preserveCodeOwnedMessageMemoryPublications,
} from './chatMessageMemoryPublicationMutationFence';
import { resolveRewindUserMessageEligibility } from './chatStoreUserMessageRewind';

type ChatStoreSet = StoreApi<ChatState>['setState'];

function stripUntrustedToolEffectReceipts(toolCall: ToolCall): ToolCall {
  const sanitized = { ...toolCall };
  delete sanitized.effectReceipts;
  return sanitized;
}

function updateConversationMessageWithMemoryPublicationFence(
  conversations: ChatState['conversations'],
  conversationId: string,
  messageId: string,
  updater: (message: Message) => Message,
): ChatState['conversations'] | undefined {
  return updateConversationById(conversations, conversationId, (conversation) => {
    const messageIndex = conversation.messages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) return conversation;

    const message = conversation.messages[messageIndex];
    const nextMessage = updater(message);
    if (nextMessage === message) return conversation;

    const nextMessages = [...conversation.messages];
    nextMessages[messageIndex] = nextMessage;
    assertMemoryPublicationLockedSourcesUnchanged(conversation.messages, nextMessages);
    return { ...conversation, messages: nextMessages };
  });
}

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
  | 'transitionMessageMemoryPublication'
  | 'updateMessageEffect'
  | 'rewindUserMessageForResend'
  | 'setLoading'
  | 'addToolCall'
  | 'updateToolCallStatus'
> {
  return {
    addMessage: (conversationId, message) => {
      const { memoryPublication: _untrustedMemoryPublication, ...trustedMessage } =
        message as typeof message & Pick<Message, 'memoryPublication'>;
      set((state) => ({
        conversations: state.conversations.map((c) => {
          if (c.id !== conversationId) return c;
          const timestamp = message.timestamp ?? Date.now();
          const newMessage: Message = {
            ...trustedMessage,
            id: message.id || generateId(),
            timestamp,
            ...(message.toolCalls
              ? { toolCalls: message.toolCalls.map(stripUntrustedToolEffectReceipts) }
              : {}),
          };
          const shouldAutoTitle =
            message.role === 'user' && !!message.content?.trim() && isPlaceholderTitle(c.title);
          return {
            ...c,
            title: shouldAutoTitle ? generateConversationTitle(message.content) : c.title,
            messages: capMessages([...c.messages, newMessage]),
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
            const nextMessages = capMessages(
              preserveCodeOwnedMessageMemoryPublications(conversation.messages, messages),
            );
            if (nextMessages.length === 0) {
              return conversation;
            }
            assertConversationCompactionMemoryPublicationSourcesSafe(
              conversation.messages,
              nextMessages,
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

    updateMessage: (conversationId, messageId, content) =>
      set((state) => {
        const conversations = updateConversationMessageWithMemoryPublicationFence(
          state.conversations,
          conversationId,
          messageId,
          (message) => (message.content === content ? message : { ...message, content }),
        );
        return conversations ? { conversations } : state;
      }),

    updateMessageEnrichedContent: (conversationId, messageId, enrichedContent) =>
      set((state) => {
        const conversations = updateConversationMessageWithMemoryPublicationFence(
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
        const conversations = updateConversationMessageWithMemoryPublicationFence(
          state.conversations,
          conversationId,
          messageId,
          (message) => {
            const nextMetadata = mergeAssistantMessageMetadata(
              message.assistantMetadata,
              assistantMetadata,
            );
            return areAssistantMessageMetadataEqual(message.assistantMetadata, nextMetadata)
              ? message
              : { ...message, assistantMetadata: nextMetadata };
          },
        );
        return conversations ? { conversations } : state;
      }),

    transitionMessageMemoryPublication: (conversationId, messageId, disposition) => {
      let result: TransitionMessageMemoryPublicationResult = {
        status: 'rejected',
        reason: 'source_unavailable',
      };
      let shouldCheckpoint = false;
      set((state) => {
        const conversationIndexes = state.conversations.flatMap((conversation, index) =>
          conversation.id === conversationId ? [index] : [],
        );
        if (conversationIndexes.length === 0) return state;
        if (conversationIndexes.length !== 1) {
          result = { status: 'rejected', reason: 'source_identity_invalid' };
          return state;
        }
        const conversationIndex = conversationIndexes[0];
        const conversation = state.conversations[conversationIndex];
        const messageIndexes = conversation.messages.flatMap((message, index) =>
          message.id === messageId ? [index] : [],
        );
        if (messageIndexes.length === 0) return state;
        if (messageIndexes.length !== 1) {
          result = { status: 'rejected', reason: 'source_identity_invalid' };
          return state;
        }
        const messageIndex = messageIndexes[0];
        const message = conversation.messages[messageIndex];
        if (!isEligibleMessageMemoryPublicationSource(message)) {
          result = { status: 'rejected', reason: 'source_ineligible' };
          return state;
        }

        const current = normalizeMessageMemoryPublication(message.memoryPublication);
        if (message.memoryPublication !== undefined && current === undefined) {
          result = { status: 'rejected', reason: 'transition_conflict' };
          return state;
        }
        const transition = resolveMessageMemoryPublicationTransition(current, {
          version: 1,
          disposition,
        });
        if (!transition.applied) {
          result = { status: 'rejected', reason: 'transition_conflict' };
          return state;
        }
        result = {
          status: 'applied',
          changed: transition.changed,
          publication: transition.publication,
        };
        if (!transition.changed) return state;

        shouldCheckpoint = true;
        const messages = [...conversation.messages];
        messages[messageIndex] = { ...message, memoryPublication: transition.publication };
        const conversations = [...state.conversations];
        conversations[conversationIndex] = { ...conversation, messages };
        return { conversations };
      });
      if (shouldCheckpoint) {
        requestChatStorePersistenceCheckpoint();
      }
      return result;
    },

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
        const {
          enrichedContent: _discardedEnrichedContent,
          memoryPublication: _discardedMemoryPublication,
          ...preservedMessage
        } = message;
        const replacementMessage: Message = {
          ...preservedMessage,
          id: replacementMessageId,
          content: newContent,
          timestamp: replacementTimestamp,
        };
        const nextMessages = [...conversation.messages.slice(0, messageIndex), replacementMessage];
        assertMemoryPublicationLockedSourcesUnchanged(conversation.messages, nextMessages);

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
      return result;
    },

    setLoading: (loading) =>
      set((state) => (state.isLoading === loading ? state : { isLoading: loading })),

    addToolCall: (conversationId, messageId, toolCall) =>
      set((state) => {
        const conversations = updateConversationMessageWithMemoryPublicationFence(
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
        const conversations = updateConversationMessageWithMemoryPublicationFence(
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
