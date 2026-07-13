import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import type { AgentRunAsyncOperation } from '../../../types/agentRun';
import type { AssistantDraftMode, ResumeAgentRun, RunChatOptions } from './contracts';
import { executeForegroundConversationRun } from './execution';
import type {
  ForegroundConversationRunHelpers,
  ForegroundConversationRunRefs,
  ForegroundConversationRunRequestActions,
  ForegroundConversationRunState,
  ForegroundConversationRunStoreActions,
  ForegroundConversationRunStreamingActions,
} from './executionTypes';
import {
  activateForegroundModelExecution,
  completeForegroundModelExecution,
  createForegroundModelExecution,
} from '../../../services/executionJournal/foregroundModelExecutionJournal';
import { relinquishForegroundModelExecutionProcessOwnership } from '../../../services/executionJournal/foregroundModelExecutionProcessOwnership';
import { flushChatStorePersistenceNow } from '../../../store/chatStorePersistence';
import { waitForPersistedAgentRecoveryReadiness } from '../../../services/startupRecovery';
import {
  claimModelProjection,
  mutateOwnedModelProjection,
  ownsModelProjection,
  releaseModelProjection,
  waitForModelProjectionAvailability,
} from '../../../store/modelProjectionOwnership';

type UseForegroundConversationRunnerParams = {
  appendConversationLog: ForegroundConversationRunHelpers['appendConversationLog'];
  clearForegroundRequest: ForegroundConversationRunRequestActions['clearForegroundRequest'];
  clearPendingRunState: ForegroundConversationRunHelpers['clearPendingRunState'];
  clearStreamingDraft: ForegroundConversationRunStreamingActions['clearStreamingDraft'];
  clearTrackedRunCancellation: ForegroundConversationRunHelpers['clearTrackedRunCancellation'];
  createId: ForegroundConversationRunHelpers['createId'];
  ensureAgentRunFinalResponse: ForegroundConversationRunHelpers['ensureAgentRunFinalResponse'];
  ensureCanonicalConversation: ForegroundConversationRunHelpers['ensureCanonicalConversation'];
  getConversation: ForegroundConversationRunHelpers['getConversation'];
  getConversations: ForegroundConversationRunHelpers['getConversations'];
  isCurrentForegroundRequest: ForegroundConversationRunRequestActions['isCurrentForegroundRequest'];
  mergeStreamingDraft: ForegroundConversationRunStreamingActions['mergeStreamingDraft'];
  recordConversationTurnMemory: ForegroundConversationRunHelpers['recordConversationTurnMemory'];
  registerForegroundRequest: ForegroundConversationRunRequestActions['registerForegroundRequest'];
  requestPersistenceCheckpoint: ForegroundConversationRunHelpers['requestPersistenceCheckpoint'];
  resumeAgentRunRef: MutableRefObject<ResumeAgentRun | null>;
  refs: ForegroundConversationRunRefs;
  requests: Pick<
    ForegroundConversationRunRequestActions,
    'abortForegroundRequestForConversation' | 'setStreamingMessageId'
  >;
  setChatError: ForegroundConversationRunHelpers['setChatError'];
  state: ForegroundConversationRunState;
  store: ForegroundConversationRunStoreActions;
  updateStreamingDraft: ForegroundConversationRunStreamingActions['updateStreamingDraft'];
};

export function useForegroundConversationRunner(
  params: UseForegroundConversationRunnerParams,
): (conversationId: string, options?: RunChatOptions) => Promise<void> {
  const context = useMemo(
    () => ({
      durability: {
        activateModelExecution: activateForegroundModelExecution,
        claimModelProjection,
        completeModelExecution: completeForegroundModelExecution,
        createModelExecution: createForegroundModelExecution,
        flushChatState: flushChatStorePersistenceNow,
        mutateModelProjection: mutateOwnedModelProjection,
        ownsModelProjection,
        releaseModelProjection,
        relinquishModelExecutionProcessOwnership:
          relinquishForegroundModelExecutionProcessOwnership,
        waitForRecoveryReadiness: waitForPersistedAgentRecoveryReadiness,
        waitForProjectionAvailability: waitForModelProjectionAvailability,
      },
      helpers: {
        appendConversationLog: params.appendConversationLog,
        clearPendingRunState: params.clearPendingRunState,
        clearTrackedRunCancellation: params.clearTrackedRunCancellation,
        createId: params.createId,
        ensureAgentRunFinalResponse: params.ensureAgentRunFinalResponse,
        ensureCanonicalConversation: params.ensureCanonicalConversation,
        getConversation: params.getConversation,
        getConversations: params.getConversations,
        getResumeAgentRun: () => params.resumeAgentRunRef.current,
        recordConversationTurnMemory: params.recordConversationTurnMemory,
        requestPersistenceCheckpoint: params.requestPersistenceCheckpoint,
        setChatError: params.setChatError,
      },
      refs: params.refs,
      requests: {
        abortForegroundRequestForConversation:
          params.requests.abortForegroundRequestForConversation,
        clearForegroundRequest: params.clearForegroundRequest,
        isCurrentForegroundRequest: params.isCurrentForegroundRequest,
        registerForegroundRequest: params.registerForegroundRequest,
        setStreamingMessageId: params.requests.setStreamingMessageId,
      },
      state: params.state,
      store: params.store,
      streaming: {
        clearStreamingDraft: params.clearStreamingDraft,
        mergeStreamingDraft: params.mergeStreamingDraft,
        updateStreamingDraft: params.updateStreamingDraft,
      },
    }),
    [
      params.appendConversationLog,
      params.clearForegroundRequest,
      params.clearPendingRunState,
      params.clearStreamingDraft,
      params.clearTrackedRunCancellation,
      params.createId,
      params.ensureAgentRunFinalResponse,
      params.ensureCanonicalConversation,
      params.getConversation,
      params.getConversations,
      params.isCurrentForegroundRequest,
      params.mergeStreamingDraft,
      params.recordConversationTurnMemory,
      params.refs,
      params.registerForegroundRequest,
      params.requestPersistenceCheckpoint,
      params.requests.abortForegroundRequestForConversation,
      params.requests.setStreamingMessageId,
      params.resumeAgentRunRef,
      params.setChatError,
      params.state,
      params.store,
      params.updateStreamingDraft,
    ],
  );
  const contextRef = useRef(context);
  contextRef.current = context;

  const runChat = useCallback(async (conversationId: string, options?: RunChatOptions) => {
    await executeForegroundConversationRun({
      conversationId,
      options,
      context: contextRef.current,
    });
  }, []);

  const resumeAgentRun = useCallback(
    async (resumeParams: {
      conversationId: string;
      runId: string;
      additionalSystemPrompt: string;
      additionalUserPrompt?: string;
      disableTools?: boolean;
      assistantDraftMode: AssistantDraftMode;
      initialPendingAsyncOperations?: AgentRunAsyncOperation[];
    }) => {
      await runChat(resumeParams.conversationId, {
        reuseAgentRunId: resumeParams.runId,
        assistantDraftMode: resumeParams.assistantDraftMode,
        additionalSystemPrompt: resumeParams.additionalSystemPrompt,
        additionalUserPrompt: resumeParams.additionalUserPrompt,
        disableTools: resumeParams.disableTools,
        initialPendingAsyncOperations: resumeParams.initialPendingAsyncOperations,
      });
    },
    [runChat],
  );

  params.resumeAgentRunRef.current = resumeAgentRun;

  useEffect(() => {
    params.resumeAgentRunRef.current = resumeAgentRun;

    return () => {
      if (params.resumeAgentRunRef.current === resumeAgentRun) {
        params.resumeAgentRunRef.current = null;
      }
    };
  }, [params.resumeAgentRunRef, resumeAgentRun]);

  return runChat;
}
