import type { StoreApi } from 'zustand';
import type { ConversationLogEntry } from '../types/conversation';
import { generateId } from '../utils/id';
import { estimateCost, isZeroCostModel } from '../services/usage/tracker';
import type { ChatState } from './chatStoreTypes';

const MAX_CONVERSATION_USAGE_ENTRIES = 200;
const MAX_CONVERSATION_LOG_ENTRIES = 250;

type ChatStoreSet = StoreApi<ChatState>['setState'];

export function createUsageStoreActions(
  set: ChatStoreSet,
): Pick<ChatState, 'recordConversationUsage' | 'addConversationLog'> {
  return {
    recordConversationUsage: (conversationId, usage) =>
      set((state) => ({
        conversations: state.conversations.map((conversation) => {
          if (conversation.id !== conversationId) {
            return conversation;
          }

          const timestamp = usage.timestamp ?? Date.now();
          const inputTokens = Math.max(0, usage.inputTokens ?? 0);
          const outputTokens = Math.max(0, usage.outputTokens ?? 0);
          const cacheReadTokens = Math.max(0, usage.cacheReadTokens ?? 0);
          const cacheWriteTokens = Math.max(0, usage.cacheWriteTokens ?? 0);
          const totalTokens = Math.max(inputTokens + outputTokens, usage.totalTokens ?? 0);
          const currentUsage = conversation.usage ?? {
            entries: [],
            totalInput: 0,
            totalOutput: 0,
            totalCacheRead: 0,
            totalCacheWrite: 0,
            totalTokens: 0,
            totalCost: 0,
            totalCalls: 0,
          };

          if (
            usage.toolCallId &&
            currentUsage.entries.some((entry) => entry.toolCallId === usage.toolCallId)
          ) {
            return conversation;
          }

          const estimatedCost = isZeroCostModel(usage.model)
            ? 0
            : (usage.estimatedCost ??
              estimateCost(usage.model, inputTokens, outputTokens, {
                cacheReadTokens,
                cacheWriteTokens,
                tokenDetails: usage.tokenDetails,
              }));
          const entry = {
            model: usage.model,
            providerId: usage.providerId,
            source: usage.source,
            modality: usage.modality,
            toolCallId: usage.toolCallId,
            sessionId: usage.sessionId,
            parentSessionId: usage.parentSessionId,
            agentRunId: usage.agentRunId,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            totalTokens,
            estimatedCost,
            ...(usage.tokenDetails ? { tokenDetails: usage.tokenDetails } : {}),
            ...(usage.tokenBuckets ? { tokenBuckets: usage.tokenBuckets } : {}),
            ...(usage.promptCache ? { promptCache: usage.promptCache } : {}),
            timestamp,
          };

          return {
            ...conversation,
            updatedAt: Math.max(conversation.updatedAt, timestamp),
            usage: {
              entries: [...currentUsage.entries, entry].slice(-MAX_CONVERSATION_USAGE_ENTRIES),
              totalInput: currentUsage.totalInput + inputTokens,
              totalOutput: currentUsage.totalOutput + outputTokens,
              totalCacheRead: currentUsage.totalCacheRead + cacheReadTokens,
              totalCacheWrite: currentUsage.totalCacheWrite + cacheWriteTokens,
              totalTokens: currentUsage.totalTokens + totalTokens,
              totalCost: currentUsage.totalCost + estimatedCost,
              totalCalls: currentUsage.totalCalls + 1,
              lastModel: usage.model,
              lastProviderId: usage.providerId,
              lastUpdatedAt: timestamp,
            },
          };
        }),
      })),

    addConversationLog: (conversationId, entry) =>
      set((state) => ({
        conversations: state.conversations.map((conversation) => {
          if (conversation.id !== conversationId) {
            return conversation;
          }

          const timestamp = entry.timestamp ?? Date.now();
          const nextEntry: ConversationLogEntry = {
            id: generateId(),
            timestamp,
            level: entry.level ?? 'info',
            kind: entry.kind ?? 'system',
            title: entry.title,
            detail: entry.detail,
          };

          return {
            ...conversation,
            updatedAt: Math.max(conversation.updatedAt, timestamp),
            logs: [...(conversation.logs ?? []), nextEntry].slice(-MAX_CONVERSATION_LOG_ENTRIES),
          };
        }),
      })),
  };
}
