import type { AgentControlGraphInterruptedResponseOutcome } from '../interruptedResponseRecovery';

const AGENT_CONTROL_GRAPH_GOALS_REVIEW_CHECKPOINT_TITLE = 'Goals review required';
import { useChatStore } from '../../../store/useChatStore';
import { buildAssistantMessageMetadata } from '../../../utils/assistantMessageMetadata';
import type { AgentRun, AgentRunTerminalReason } from '../../../types/agentRun';
import type { ConversationLogEntry } from '../../../types/conversation';
import type { RecoverAgentRunFinalPreview, ResumeAgentRun } from './contracts';
import {
  buildAgentControlGraphFinalReviewRecoverySystemPrompt,
  buildAgentControlGraphFinalReviewRecoveryUserPrompt,
} from '../finalReviewGate';
import { consumeAgentRunAutomaticRecoveryAttempt } from './automaticRecoveryBudget';

type ChatStore = ReturnType<typeof useChatStore.getState>;

type AppendConversationLog = (
  conversationId: string,
  entry: {
    title: string;
    detail?: string;
    level?: ConversationLogEntry['level'];
    kind?: ConversationLogEntry['kind'];
    timestamp?: number;
  },
) => void;

type FinalizeTrackedRun = (
  status: Exclude<AgentRun['status'], 'running'>,
  latestSummary: string,
  checkpointTitle: string,
  checkpointDetail?: string,
  terminalReason?: AgentRunTerminalReason,
) => boolean;

export async function handleForegroundInterruptedResponseRecovery(params: {
  appendConversationLog: AppendConversationLog;
  assertNotAborted: () => void;
  clearForegroundRequestIfCurrent: () => boolean;
  conversationId: string;
  currentAssistantMessageId: string;
  errorMessage: string;
  finalizeTrackedRun: FinalizeTrackedRun;
  flushChatState: () => Promise<void>;
  markCurrentAssistantDraftIncomplete: (
    visibleContent: string,
    finishReason: 'response_failed' | 'terminal_review_pending',
  ) => void;
  outcome: AgentControlGraphInterruptedResponseOutcome;
  recoverAgentRunFinalPreview: RecoverAgentRunFinalPreview;
  requestPersistenceCheckpoint: () => void;
  resumeAgentRun?: ResumeAgentRun | null;
  runId?: string | null;
  setAgentRunPhase: ChatStore['setAgentRunPhase'];
  setChatError: (message: string | null) => void;
  signal: AbortSignal;
  updateAgentRunAsyncWork: ChatStore['updateAgentRunAsyncWork'];
  updateAgentRunControlGraph: ChatStore['updateAgentRunControlGraph'];
  updateAgentRunSummary: ChatStore['updateAgentRunSummary'];
  updateMessage: ChatStore['updateMessage'];
  updateMessageAssistantMetadata: ChatStore['updateMessageAssistantMetadata'];
  visibleContent: string;
}): Promise<void> {
  const { outcome, runId } = params;

  const consumeAutomaticRecovery = (reason: string) => {
    const latestRun = runId
      ? useChatStore
          .getState()
          .conversations.find((conversation) => conversation.id === params.conversationId)
          ?.agentRuns?.find((run) => run.id === runId)
      : undefined;
    const budget = consumeAgentRunAutomaticRecoveryAttempt({
      controlGraph: latestRun?.controlGraph,
      reason,
    });
    if (budget.type === 'consumed' && runId) {
      params.updateAgentRunControlGraph(params.conversationId, budget.controlGraph, runId);
    }
    return budget.type;
  };

  const stopAutomaticRecovery = (detail: string) => {
    const visibleFailure = params.visibleContent.trim()
      ? `${params.visibleContent.trim()}\n\n${detail}`
      : detail;
    params.updateMessage(
      params.conversationId,
      params.currentAssistantMessageId,
      visibleFailure,
    );
    params.updateMessageAssistantMetadata(
      params.conversationId,
      params.currentAssistantMessageId,
      buildAssistantMessageMetadata('final', {
        completionStatus: 'incomplete',
        finishReason: 'response_failed',
      }),
    );
    const terminalized = params.finalizeTrackedRun(
      'failed',
      detail,
      'Automatic recovery stopped',
      detail,
      'terminal_review_unavailable',
    );
    if (terminalized) {
      params.appendConversationLog(params.conversationId, {
        kind: 'error',
        level: 'error',
        title: 'Automatic recovery stopped',
        detail,
      });
    }
    params.setChatError(detail);
    params.requestPersistenceCheckpoint();
  };

  if (outcome.resumePrompt && runId && params.resumeAgentRun) {
    const recoveryBudget = consumeAutomaticRecovery('automatic interrupted-goal recovery');
    if (recoveryBudget !== 'consumed') {
      stopAutomaticRecovery(
        recoveryBudget === 'exhausted'
          ? 'Automatic interrupted-goal recovery reached its persisted retry limit.'
          : 'Automatic interrupted-goal recovery could not establish a safe resumable graph boundary.',
      );
      return;
    }
    params.markCurrentAssistantDraftIncomplete(params.visibleContent, 'terminal_review_pending');
    params.setAgentRunPhase(
      params.conversationId,
      'work',
      {
        status: 'active',
        detail: outcome.checkpointDetail,
        checkpointTitle:
          outcome.checkpointTitle || AGENT_CONTROL_GRAPH_GOALS_REVIEW_CHECKPOINT_TITLE,
        checkpointDetail: outcome.checkpointDetail,
      },
      runId,
    );
    params.updateAgentRunSummary(
      params.conversationId,
      {
        latestSummary: outcome.checkpointDetail,
      },
      runId,
    );
    params.appendConversationLog(params.conversationId, {
      kind: 'state',
      level: 'warning',
      title: outcome.checkpointTitle,
      detail: outcome.checkpointDetail,
    });

    params.clearForegroundRequestIfCurrent();
    params.assertNotAborted();
    await params.flushChatState();
    params.assertNotAborted();

    await params.resumeAgentRun({
      conversationId: params.conversationId,
      runId,
      additionalSystemPrompt: outcome.resumePrompt,
      additionalUserPrompt: outcome.resumeUserPrompt,
    });

    params.assertNotAborted();
    params.requestPersistenceCheckpoint();
    return;
  }

  if (runId && outcome.keepRunOpen === 'async-operations') {
    const reviewTimestamp = Date.now();
    params.setAgentRunPhase(
      params.conversationId,
      'work',
      {
        status: 'active',
        detail: outcome.checkpointDetail,
        checkpointTitle: outcome.checkpointTitle,
        checkpointDetail: outcome.checkpointDetail,
        timestamp: reviewTimestamp,
        allowRegression: true,
      },
      runId,
    );
    params.updateAgentRunSummary(
      params.conversationId,
      {
        latestSummary: outcome.checkpointDetail,
        timestamp: reviewTimestamp,
      },
      runId,
    );
    params.appendConversationLog(params.conversationId, {
      kind: 'state',
      level: 'warning',
      title: outcome.checkpointTitle,
      detail: outcome.checkpointDetail,
      timestamp: reviewTimestamp,
    });
    params.requestPersistenceCheckpoint();
    return;
  }

  const recoveredFinal = await params.recoverAgentRunFinalPreview(
    outcome.status,
    undefined,
    undefined,
    params.signal,
  );
  params.assertNotAborted();
  const resumeFinalDelivery = async (): Promise<void> => {
    if (!runId || !params.resumeAgentRun) return;
    params.clearForegroundRequestIfCurrent();
    params.assertNotAborted();
    await params.flushChatState();
    params.assertNotAborted();
    await params.resumeAgentRun({
      conversationId: params.conversationId,
      runId,
      additionalSystemPrompt: buildAgentControlGraphFinalReviewRecoverySystemPrompt(),
      additionalUserPrompt: buildAgentControlGraphFinalReviewRecoveryUserPrompt(),
      disableTools: true,
      reuseAssistantDraft: false,
    });
    params.assertNotAborted();
  };
  const prepareFinalDeliveryResume = () =>
    runId && params.resumeAgentRun
      ? consumeAutomaticRecovery('automatic interrupted final delivery recovery')
      : ('not_requested' as const);
  const holdTerminalization = (paramsForHold: {
    checkpointTitle: string;
    detail: string;
    markDeliveryPending: boolean;
  }) => {
    if (paramsForHold.markDeliveryPending) {
      params.markCurrentAssistantDraftIncomplete(
        params.visibleContent,
        'terminal_review_pending',
      );
    }
    if (runId) {
      params.setAgentRunPhase(
        params.conversationId,
        paramsForHold.markDeliveryPending ? 'deliver' : 'review',
        {
          status: 'active',
          detail: paramsForHold.detail,
          checkpointTitle: paramsForHold.checkpointTitle,
          checkpointDetail: paramsForHold.detail,
          allowRegression: true,
        },
        runId,
      );
      params.updateAgentRunSummary(
        params.conversationId,
        { latestSummary: paramsForHold.detail },
        runId,
      );
    }
    params.appendConversationLog(params.conversationId, {
      kind: 'state',
      level: 'warning',
      title: paramsForHold.checkpointTitle,
      detail: paramsForHold.detail,
    });
    params.requestPersistenceCheckpoint();
  };
  if (outcome.status === 'completed' && !recoveredFinal.delivered) {
    const recoveryBudget = prepareFinalDeliveryResume();
    if (recoveryBudget === 'exhausted' || recoveryBudget === 'unavailable') {
      stopAutomaticRecovery(
        recoveryBudget === 'exhausted'
          ? 'Automatic final delivery recovery reached its persisted retry limit.'
          : 'Automatic final delivery recovery could not establish a safe resumable graph boundary.',
      );
      return;
    }
    holdTerminalization({
      checkpointTitle: 'Final delivery recovery pending',
      detail:
        'The run reached a completable state, but no settled final assistant response was persisted. Final delivery remains retryable.',
      markDeliveryPending: true,
    });
    if (recoveryBudget === 'consumed') await resumeFinalDelivery();
    return;
  }
  const latestSummary =
    recoveredFinal.preview || params.visibleContent || `Error: ${params.errorMessage}`;

  const terminalized = params.finalizeTrackedRun(
    outcome.status,
    latestSummary,
    outcome.checkpointTitle,
    outcome.checkpointDetail,
    outcome.terminalReason,
  );
  if (!terminalized) {
    const recoveryBudget =
      outcome.status === 'completed' ? prepareFinalDeliveryResume() : 'not_requested';
    if (recoveryBudget === 'exhausted' || recoveryBudget === 'unavailable') {
      stopAutomaticRecovery(
        recoveryBudget === 'exhausted'
          ? 'Automatic final delivery recovery reached its persisted retry limit.'
          : 'Automatic final delivery recovery could not establish a safe resumable graph boundary.',
      );
      return;
    }
    holdTerminalization({
      checkpointTitle:
        outcome.status === 'completed'
          ? 'Final delivery recovery pending'
          : 'Run terminalization recovery pending',
      detail:
        outcome.status === 'completed'
          ? 'A final response was persisted, but the control graph was not at a safe completion boundary. Final delivery remains retryable.'
          : 'The terminal outcome could not be committed at the current control-graph boundary. Terminalization remains retryable.',
      markDeliveryPending: outcome.status === 'completed',
    });
    if (recoveryBudget === 'consumed') {
      await resumeFinalDelivery();
    }
    return;
  }
  if (!recoveredFinal.recovered && outcome.status !== 'completed') {
    params.setChatError(params.errorMessage);
  }
  params.appendConversationLog(params.conversationId, {
    kind: 'error',
    level: outcome.status === 'completed' || recoveredFinal.recovered ? 'warning' : 'error',
    title:
      outcome.status === 'completed'
        ? 'Response interrupted; recovered final answer'
        : recoveredFinal.recovered
          ? outcome.checkpointTitle
          : 'Response failed',
    detail: outcome.status === 'completed' ? params.errorMessage : outcome.checkpointDetail,
  });

  if (!recoveredFinal.recovered && outcome.status !== 'completed') {
    params.updateMessage(
      params.conversationId,
      params.currentAssistantMessageId,
      params.visibleContent || `Error: ${params.errorMessage}`,
    );
    params.updateMessageAssistantMetadata(
      params.conversationId,
      params.currentAssistantMessageId,
      buildAssistantMessageMetadata('final', {
        completionStatus: 'incomplete',
        finishReason: 'response_failed',
      }),
    );
  }

  params.requestPersistenceCheckpoint();
}
