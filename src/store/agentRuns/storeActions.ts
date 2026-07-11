import type { StoreApi } from 'zustand';
import { generateId } from '../../utils/id';
import type { AgentRunEvidenceEntry } from '../../types/agentRun';
import { type AgentRunEvidenceDraft } from '../../services/agents/lifecycle/evidenceTypes';
import { requestChatStorePersistenceCheckpoint } from '../chatStorePersistence';
import { updateConversationById } from '../chatStoreHelpers';
import type { ChatState } from '../chatStoreTypes';
import {
  appendAgentRunCheckpointInConversation,
  completeAgentRunInConversation,
  setAgentRunPhaseInConversation,
  startAgentRunInConversation,
  updateAgentRunSummaryInConversation,
} from './lifecycle';
import {
  recordAgentRunEvidenceInConversation,
  updateAgentRunAsyncWorkInConversation,
  updateAgentRunControlGraphInConversation,
  updateAgentRunPlanInConversation,
} from './graph';
import { recoverInterruptedAgentRunsInConversation } from './recovery';

type ChatStoreSet = StoreApi<ChatState>['setState'];

export function createAgentRunStoreActions(
  set: ChatStoreSet,
): Pick<
  ChatState,
  | 'startAgentRun'
  | 'setAgentRunPhase'
  | 'appendAgentRunCheckpoint'
  | 'updateAgentRunSummary'
  | 'updateAgentRunAsyncWork'
  | 'updateAgentRunControlGraph'
  | 'updateAgentRunPlan'
  | 'recordAgentRunEvidence'
  | 'completeAgentRun'
  | 'recoverInterruptedAgentRuns'
> {
  return {
    startAgentRun: (conversationId, params) => {
      const timestamp = params.timestamp ?? Date.now();
      const runId = generateId();

      set((state) => {
        const conversations = updateConversationById(
          state.conversations,
          conversationId,
          (conversation) =>
            startAgentRunInConversation(conversation, {
              ...params,
              runId,
              timestamp,
            }),
        );
        return conversations ? { conversations } : state;
      });

      requestChatStorePersistenceCheckpoint();

      return runId;
    },

    setAgentRunPhase: (conversationId, phase, params, runId) =>
      set((state) => {
        const conversations = updateConversationById(
          state.conversations,
          conversationId,
          (conversation) => setAgentRunPhaseInConversation(conversation, phase, params, runId),
        );
        return conversations ? { conversations } : state;
      }),

    appendAgentRunCheckpoint: (conversationId, entry, runId) =>
      set((state) => {
        const conversations = updateConversationById(
          state.conversations,
          conversationId,
          (conversation) => appendAgentRunCheckpointInConversation(conversation, entry, runId),
        );
        return conversations ? { conversations } : state;
      }),

    updateAgentRunSummary: (conversationId, patch, runId) =>
      set((state) => {
        const conversations = updateConversationById(
          state.conversations,
          conversationId,
          (conversation) => updateAgentRunSummaryInConversation(conversation, patch, runId),
        );
        return conversations ? { conversations } : state;
      }),

    updateAgentRunAsyncWork: (conversationId, params, runId) => {
      set((state) => {
        const conversations = updateConversationById(
          state.conversations,
          conversationId,
          (conversation) => updateAgentRunAsyncWorkInConversation(conversation, params, runId),
        );
        return conversations ? { conversations } : state;
      });
      requestChatStorePersistenceCheckpoint();
    },

    updateAgentRunControlGraph: (conversationId, controlGraph, runId) => {
      set((state) => {
        const conversations = updateConversationById(
          state.conversations,
          conversationId,
          (conversation) =>
            updateAgentRunControlGraphInConversation(conversation, controlGraph, runId),
        );
        return conversations ? { conversations } : state;
      });
      requestChatStorePersistenceCheckpoint();
    },

    updateAgentRunPlan: (conversationId, patch, runId) => {
      set((state) => {
        const conversations = updateConversationById(
          state.conversations,
          conversationId,
          (conversation) => updateAgentRunPlanInConversation(conversation, patch, runId),
        );
        return conversations ? { conversations } : state;
      });
      requestChatStorePersistenceCheckpoint();
    },

    recordAgentRunEvidence: (conversationId, entries, params, runId) => {
      let recordedEntries: AgentRunEvidenceEntry[] | undefined;

      set((state) => {
        const conversations = updateConversationById(
          state.conversations,
          conversationId,
          (conversation) => {
            const result = recordAgentRunEvidenceInConversation(
              conversation,
              entries as AgentRunEvidenceDraft | AgentRunEvidenceDraft[],
              params,
              runId,
            );
            recordedEntries = result.recordedEntries;
            return result.conversation;
          },
        );
        return conversations ? { conversations } : state;
      });

      if (recordedEntries) {
        requestChatStorePersistenceCheckpoint();
      }

      return recordedEntries;
    },

    completeAgentRun: (conversationId, params, runId) => {
      set((state) => {
        const conversations = updateConversationById(
          state.conversations,
          conversationId,
          (conversation) => completeAgentRunInConversation(conversation, params, runId),
        );
        return conversations ? { conversations } : state;
      });
      requestChatStorePersistenceCheckpoint();
    },

    recoverInterruptedAgentRuns: (activeSubAgents, params) =>
      set((state) => {
        let didUpdateState = false;
        const nextConversations = state.conversations.map((conversation) => {
          const nextConversation = recoverInterruptedAgentRunsInConversation(
            conversation,
            activeSubAgents,
            params,
          );
          if (nextConversation !== conversation) {
            didUpdateState = true;
          }
          return nextConversation;
        });

        return didUpdateState ? { conversations: nextConversations } : state;
      }),
  };
}
