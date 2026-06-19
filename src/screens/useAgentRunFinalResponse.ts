import { useCallback, useEffect, type MutableRefObject } from 'react';
import { useChatStore } from '../store/useChatStore';
import {
  AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_DETAIL,
  AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_TITLE,
} from '../engine/graph/finalDelivery';
import {
  createAgentRunOperationController,
  throwIfAbortSignalTriggered,
} from '../services/agents/agentRunCancellation';
import {
  buildAgentRunMessageScope,
  getLatestFinalAssistantResponsePreview,
  hasDeliveredFinalAssistantResponse,
} from '../services/agents/lifecycle/agentRunStateMachine';
import {
  type EnsureAgentRunFinalResponse,
  type ResolvedFinalizationProviderContext,
} from '../engine/graph/foregroundRun/contracts';
import { synthesizeAgentRunCompletion } from './agentRunCompletionSynthesis';
import {
  recordAgentRunFinalResponseDelivery,
  writeSynthesizedFinalResponse,
} from './agentRunFinalResponseDelivery';
import { recordConversationTurnMemory } from './chatTurnMemory';
import { tryDeliverPreferredFinalResponse } from './agentRunPreferredFinalResponse';
import { resolvePreferredAgentRunFinalResponseMessageId } from './agentRunFinalResponseSelection';

type ResolveConversationFinalizationContext = (
  conversation: ReturnType<typeof useChatStore.getState>['conversations'][number],
) => Promise<ResolvedFinalizationProviderContext | undefined>;

type UseAgentRunFinalResponseParams = {
  appendAgentRunCheckpoint: ReturnType<typeof useChatStore.getState>['appendAgentRunCheckpoint'];
  appendConversationLog: (
    conversationId: string,
    entry: Parameters<ReturnType<typeof useChatStore.getState>['addConversationLog']>[1],
  ) => void;
  ensureAgentRunFinalResponseRef: MutableRefObject<EnsureAgentRunFinalResponse | null>;
  pendingAgentRunFinalizationsRef: MutableRefObject<Map<string, Promise<string | undefined>>>;
  resolveConversationFinalizationContextRef: MutableRefObject<ResolveConversationFinalizationContext | null>;
  setAgentRunPhase: ReturnType<typeof useChatStore.getState>['setAgentRunPhase'];
  updateAgentRunSummary: ReturnType<typeof useChatStore.getState>['updateAgentRunSummary'];
  updateMessage: ReturnType<typeof useChatStore.getState>['updateMessage'];
  updateMessageAssistantMetadata: ReturnType<
    typeof useChatStore.getState
  >['updateMessageAssistantMetadata'];
  updateMessageProviderReplay: ReturnType<
    typeof useChatStore.getState
  >['updateMessageProviderReplay'];
};

export function useAgentRunFinalResponse({
  appendAgentRunCheckpoint,
  appendConversationLog,
  ensureAgentRunFinalResponseRef,
  pendingAgentRunFinalizationsRef,
  resolveConversationFinalizationContextRef,
  setAgentRunPhase,
  updateAgentRunSummary,
  updateMessage,
  updateMessageAssistantMetadata,
  updateMessageProviderReplay,
}: UseAgentRunFinalResponseParams): EnsureAgentRunFinalResponse {
  const ensureAgentRunFinalResponse = useCallback<EnsureAgentRunFinalResponse>(
    async (params) => {
      const inFlightFinalization = pendingAgentRunFinalizationsRef.current.get(params.runId);
      if (inFlightFinalization) {
        return inFlightFinalization;
      }

      const finalizationPromise = (async () => {
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
            recordConversationTurnMemory(params.conversationId);
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
            recordConversationTurnMemory(params.conversationId);
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
            resolveConversationFinalizationContext:
              resolveConversationFinalizationContextRef.current ?? undefined,
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

          recordConversationTurnMemory(params.conversationId);

          return preview;
        } finally {
          operation.dispose();
          pendingAgentRunFinalizationsRef.current.delete(params.runId);
        }
      })();

      pendingAgentRunFinalizationsRef.current.set(params.runId, finalizationPromise);
      return finalizationPromise;
    },
    [
      appendAgentRunCheckpoint,
      appendConversationLog,
      pendingAgentRunFinalizationsRef,
      setAgentRunPhase,
      updateAgentRunSummary,
      updateMessage,
      updateMessageAssistantMetadata,
      updateMessageProviderReplay,
      resolveConversationFinalizationContextRef,
    ],
  );

  ensureAgentRunFinalResponseRef.current = ensureAgentRunFinalResponse;

  useEffect(() => {
    ensureAgentRunFinalResponseRef.current = ensureAgentRunFinalResponse;
  }, [ensureAgentRunFinalResponse, ensureAgentRunFinalResponseRef]);

  return ensureAgentRunFinalResponse;
}
