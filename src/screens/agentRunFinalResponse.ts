import {
  AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_DETAIL,
  AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_TITLE,
} from '../engine/graph/finalDelivery';
import {
  type EnsureAgentRunFinalResponse,
  type ResolvedFinalizationProviderContext,
} from '../engine/graph/foregroundRun/contracts';
import {
  createAgentRunOperationController,
  throwIfAbortSignalTriggered,
} from '../services/agents/agentRunCancellation';
import { createAgentRunIdentityKey } from '../services/agents/agentRunIdentity';
import {
  buildAgentRunMessageScope,
  getLatestFinalAssistantResponsePreview,
  hasDeliveredFinalAssistantResponse,
} from '../services/agents/lifecycle/agentRunStateMachine';
import { useChatStore } from '../store/useChatStore';
import type { Conversation } from '../types/conversation';
import { synthesizeAgentRunCompletion } from './agentRunCompletionSynthesis';
import {
  recordAgentRunFinalResponseDelivery,
  writeSynthesizedFinalResponse,
} from './agentRunFinalResponseDelivery';
import { resolvePreferredAgentRunFinalResponseMessageId } from './agentRunFinalResponseSelection';
import { tryDeliverPreferredFinalResponse } from './agentRunPreferredFinalResponse';

type ChatStore = ReturnType<typeof useChatStore.getState>;
export type PendingAgentRunFinalizations = Map<string, Promise<string | undefined>>;

export type ResolveConversationFinalizationContext = (
  conversation: Conversation,
) => Promise<ResolvedFinalizationProviderContext | undefined>;

export type CreateAgentRunFinalResponseParams = {
  appendAgentRunCheckpoint: ChatStore['appendAgentRunCheckpoint'];
  appendConversationLog: (
    conversationId: string,
    entry: Parameters<ChatStore['addConversationLog']>[1],
  ) => void;
  pendingAgentRunFinalizations: PendingAgentRunFinalizations;
  getResolveConversationFinalizationContext: () =>
    | ResolveConversationFinalizationContext
    | undefined;
  setAgentRunPhase: ChatStore['setAgentRunPhase'];
  updateAgentRunSummary: ChatStore['updateAgentRunSummary'];
  updateMessage: ChatStore['updateMessage'];
  updateMessageAssistantMetadata: ChatStore['updateMessageAssistantMetadata'];
  updateMessageProviderReplay: ChatStore['updateMessageProviderReplay'];
};

export function createAgentRunFinalResponse({
  appendAgentRunCheckpoint,
  appendConversationLog,
  pendingAgentRunFinalizations,
  getResolveConversationFinalizationContext,
  setAgentRunPhase,
  updateAgentRunSummary,
  updateMessage,
  updateMessageAssistantMetadata,
  updateMessageProviderReplay,
}: CreateAgentRunFinalResponseParams): EnsureAgentRunFinalResponse {
  return async (params) => {
    const runIdentityKey = createAgentRunIdentityKey(params);
    const inFlightFinalization = pendingAgentRunFinalizations.get(runIdentityKey);
    if (inFlightFinalization) {
      return inFlightFinalization;
    }

    const finalizationPromise = Promise.resolve().then(async () => {
      const operation = createAgentRunOperationController({
        conversationId: params.conversationId,
        runId: params.runId,
        operationId: 'final-response',
        parentSignal: params.signal,
      });

      try {
        throwIfAbortSignalTriggered(operation.signal);

        const conversation = useChatStore
          .getState()
          .conversations.find((candidate) => candidate.id === params.conversationId);
        const run = conversation?.agentRuns?.find((candidate) => candidate.id === params.runId);
        if (!conversation || !run) {
          return undefined;
        }
        const runMessageScope = buildAgentRunMessageScope(run);

        const existingPreview = getLatestFinalAssistantResponsePreview(
          conversation.messages,
          runMessageScope,
        );
        if (hasDeliveredFinalAssistantResponse(conversation.messages, runMessageScope)) {
          return existingPreview;
        }

        const preferredAssistantMessageId = resolvePreferredAgentRunFinalResponseMessageId({
          messages: conversation.messages,
          preferredAssistantMessageId: params.preferredAssistantMessageId,
          run,
        });
        const preferredPreview = tryDeliverPreferredFinalResponse({
          assertNotAborted: () => throwIfAbortSignalTriggered(operation.signal),
          conversation,
          conversationId: params.conversationId,
          preferredAssistantMessageId,
          run,
          runId: params.runId,
          status: params.status,
          effects: {
            appendAgentRunCheckpoint,
            appendConversationLog,
            updateAgentRunSummary,
            updateMessageAssistantMetadata,
          },
        });
        if (preferredPreview) {
          return preferredPreview;
        }

        const synthesisTimestamp = params.timestamp ?? Date.now();
        const shouldTrackSynthesisProgress = run.status === 'running';
        if (shouldTrackSynthesisProgress) {
          throwIfAbortSignalTriggered(operation.signal);

          setAgentRunPhase(
            params.conversationId,
            'deliver',
            {
              status: 'active',
              detail: AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_DETAIL,
              checkpointTitle: AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_TITLE,
              checkpointDetail: AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_DETAIL,
              timestamp: synthesisTimestamp,
            },
            params.runId,
          );
          updateAgentRunSummary(
            params.conversationId,
            {
              latestSummary: AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_DETAIL,
              timestamp: synthesisTimestamp,
            },
            params.runId,
          );
          appendConversationLog(params.conversationId, {
            kind: 'state',
            level: 'info',
            title: AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_TITLE,
            detail: AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_DETAIL,
            timestamp: synthesisTimestamp,
          });
        }

        // Graph-first completion; provider synthesis runs only when graph evidence is absent.
        const synthesized = await synthesizeAgentRunCompletion({
          conversationId: params.conversationId,
          run,
          status: params.status,
          providerContext: params.providerContext,
          resolveConversationFinalizationContext: getResolveConversationFinalizationContext(),
          signal: operation.signal,
        });

        throwIfAbortSignalTriggered(operation.signal);

        const preview = writeSynthesizedFinalResponse({
          conversation,
          conversationId: params.conversationId,
          run,
          status: params.status,
          synthesized,
          effects: {
            updateMessage,
            updateMessageAssistantMetadata,
            updateMessageProviderReplay,
          },
        });
        if (!preview) {
          return undefined;
        }

        throwIfAbortSignalTriggered(operation.signal);
        recordAgentRunFinalResponseDelivery({
          conversationId: params.conversationId,
          run,
          runId: params.runId,
          status: params.status,
          preview,
          effects: {
            appendAgentRunCheckpoint,
            appendConversationLog,
            updateAgentRunSummary,
          },
        });

        return preview;
      } finally {
        operation.dispose();
      }
    });

    pendingAgentRunFinalizations.set(runIdentityKey, finalizationPromise);
    return finalizationPromise.finally(() => {
      if (pendingAgentRunFinalizations.get(runIdentityKey) === finalizationPromise) {
        pendingAgentRunFinalizations.delete(runIdentityKey);
      }
    });
  };
}
