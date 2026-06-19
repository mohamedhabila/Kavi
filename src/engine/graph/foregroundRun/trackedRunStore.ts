import { truncateLogDetail } from '../../../utils/logDetail';
import {
  applyConversationRunCompletionEffect,
  type ConversationRunCompletionActions,
} from '../applyRunCompletionEffect';
import {
  buildForegroundAgentRunAssessPhaseEffect,
  buildForegroundAgentRunCompletionEffect,
  buildForegroundAgentRunReviewPhaseEffect,
  buildForegroundAgentRunSummaryPatch,
  buildForegroundAgentRunWorkPhaseEffect,
  type ForegroundAgentRunCounters,
  type ForegroundAgentRunPhaseEffect,
} from '../foregroundRunPhaseEffects';
import type {
  ForegroundRunGraphStateSyncEffect,
  ForegroundRunOrchestratorStateEffect,
  ForegroundRunPendingAsyncSyncEffect,
} from '../foregroundRunStateSync';
import type {
  ToolExecutionCompletionEffect,
  ToolExecutionStartEffect,
} from '../../toolExecution/toolExecutionPresentation';
import type {
  AgentRun,
  AgentRunControlGraphState,
  AgentRunTerminalReason,
} from '../../../types/agentRun';
import type { Conversation } from '../../../types/conversation';

export type ForegroundTrackedRunStoreActions = ConversationRunCompletionActions & {
  appendAgentRunCheckpoint: (
    conversationId: string,
    checkpoint: {
      kind?: AgentRun['checkpoints'][number]['kind'];
      title: string;
      detail?: string;
      timestamp?: number;
    },
    runId?: string,
  ) => void;
  setAgentRunPhase: (
    conversationId: string,
    phase: AgentRun['currentPhase'],
    params: {
      status: 'active' | 'completed';
      detail: string;
      checkpointTitle?: string;
      checkpointDetail?: string;
      allowRegression?: true;
    },
    runId?: string,
  ) => void;
  updateAgentRunAsyncWork: (
    conversationId: string,
    patch: Record<string, unknown>,
    runId?: string,
  ) => void;
  updateAgentRunPlan: (
    conversationId: string,
    patch: Record<string, unknown>,
    runId?: string,
  ) => void;
  updateAgentRunSummary: (
    conversationId: string,
    summary: Partial<AgentRun['summary']> & { latestSummary?: string },
    runId?: string,
  ) => void;
  updateAgentRunControlGraph: (
    conversationId: string,
    controlGraph: AgentRunControlGraphState | undefined,
    runId?: string,
  ) => void;
};

export function createForegroundTrackedRunStore(params: {
  actions: ForegroundTrackedRunStoreActions;
  conversationId: string;
  getCurrentCounters: () => ForegroundAgentRunCounters;
  getLatestConversation: () => Conversation | undefined;
  runId: string | undefined;
}) {
  let hasEnteredWorkPhase = false;
  let hasEnteredReviewPhase = false;

  const syncSummary = (latestSummary?: string) => {
    if (!params.runId) {
      return;
    }

    params.actions.updateAgentRunSummary(
      params.conversationId,
      buildForegroundAgentRunSummaryPatch(params.getCurrentCounters(), latestSummary),
      params.runId,
    );
  };

  const applyPhaseEffect = (effect: ForegroundAgentRunPhaseEffect) => {
    if (!params.runId) {
      return;
    }

    params.actions.setAgentRunPhase(
      params.conversationId,
      effect.phase,
      effect.params,
      params.runId,
    );
    syncSummary(effect.latestSummary);
  };

  const enterWorkPhase = (detail: string, checkpointTitle?: string) => {
    const normalizedDetail = truncateLogDetail(detail) || detail;
    applyPhaseEffect(
      buildForegroundAgentRunWorkPhaseEffect({
        detail: normalizedDetail,
        checkpointTitle,
        hasEnteredPhase: hasEnteredWorkPhase,
      }),
    );
    hasEnteredWorkPhase = true;
  };

  const enterAssessPhase = (detail = 'Analyzing the task') => {
    applyPhaseEffect(buildForegroundAgentRunAssessPhaseEffect(detail));
  };

  const enterReviewPhase = (detail: string, checkpointTitle?: string) => {
    const normalizedDetail = truncateLogDetail(detail) || detail;
    applyPhaseEffect(
      buildForegroundAgentRunReviewPhaseEffect({
        detail: normalizedDetail,
        checkpointTitle,
        hasEnteredPhase: hasEnteredReviewPhase,
      }),
    );
    hasEnteredReviewPhase = true;
  };

  const finalizeRun = (
    status: Exclude<AgentRun['status'], 'running'>,
    latestSummary: string,
    checkpointTitle: string,
    checkpointDetail?: string,
    terminalReason?: AgentRunTerminalReason,
  ) => {
    if (!params.runId) {
      return;
    }

    applyConversationRunCompletionEffect({
      actions: params.actions,
      conversationId: params.conversationId,
      effect: buildForegroundAgentRunCompletionEffect({
        checkpointDetail,
        checkpointTitle,
        counters: params.getCurrentCounters(),
        latestSummary,
        status,
        terminalReason,
      }).params,
      getLatestConversation: params.getLatestConversation,
      runId: params.runId,
    });
  };

  const applyPendingAsyncSyncEffect = (effect: ForegroundRunPendingAsyncSyncEffect) => {
    if (!params.runId) {
      return;
    }

    params.actions.updateAgentRunAsyncWork(
      params.conversationId,
      effect.asyncWorkPatch,
      params.runId,
    );

    if (effect.workPhasePresentation) {
      enterWorkPhase(
        effect.workPhasePresentation.detail,
        effect.workPhasePresentation.checkpointTitle,
      );
    }
  };

  const applyOrchestratorStateEffect = (effect: ForegroundRunOrchestratorStateEffect) => {
    if (effect.assessSummary) {
      enterAssessPhase(effect.assessSummary);
    }
  };

  const applyToolStartEffect = (effect: ToolExecutionStartEffect) => {
    if (!params.runId) {
      return;
    }

    params.actions.appendAgentRunCheckpoint(params.conversationId, effect.checkpoint, params.runId);
    enterWorkPhase(effect.workPhase.title, effect.workPhase.checkpointTitle);
  };

  const applyToolCompletionEffect = (effect: ToolExecutionCompletionEffect) => {
    if (!params.runId) {
      return;
    }

    params.actions.appendAgentRunCheckpoint(params.conversationId, effect.checkpoint, params.runId);
    enterWorkPhase(effect.workPhaseDetail);
  };

  const markAwaitingBackgroundWorkers = (paramsForWait: {
    latestSummary: string;
    checkpointTitle: string;
    checkpointDetail: string;
  }) => {
    if (!params.runId) {
      return;
    }

    params.actions.updateAgentRunAsyncWork(
      params.conversationId,
      {
        awaitingBackgroundWorkers: true,
        latestSummary: paramsForWait.latestSummary,
        checkpointTitle: paramsForWait.checkpointTitle,
        checkpointDetail: paramsForWait.checkpointDetail,
      },
      params.runId,
    );
  };

  const applyGraphStateSyncEffect = (effect: ForegroundRunGraphStateSyncEffect) => {
    if (!params.runId) {
      return;
    }

    params.actions.updateAgentRunControlGraph(
      params.conversationId,
      effect.controlGraph,
      params.runId,
    );
  };

  return {
    applyGraphStateSyncEffect,
    applyOrchestratorStateEffect,
    applyPendingAsyncSyncEffect,
    applyToolCompletionEffect,
    applyToolStartEffect,
    enterReviewPhase,
    enterWorkPhase,
    finalizeRun,
    markAwaitingBackgroundWorkers,
    syncSummary,
  };
}
