import { useEffect, useMemo, type MutableRefObject } from 'react';
import { useChatStore } from '../store/useChatStore';
import { type EnsureAgentRunFinalResponse } from '../engine/graph/foregroundRun/contracts';
import {
  createAgentRunFinalResponse,
  type ResolveConversationFinalizationContext,
} from './agentRunFinalResponse';

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
  const ensureAgentRunFinalResponse = useMemo<EnsureAgentRunFinalResponse>(
    () =>
      createAgentRunFinalResponse({
        appendAgentRunCheckpoint,
        appendConversationLog,
        pendingAgentRunFinalizations: pendingAgentRunFinalizationsRef.current,
        getResolveConversationFinalizationContext: () =>
          resolveConversationFinalizationContextRef.current ?? undefined,
        setAgentRunPhase,
        updateAgentRunSummary,
        updateMessage,
        updateMessageAssistantMetadata,
        updateMessageProviderReplay,
      }),
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
