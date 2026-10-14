import type { ConversationLogEntry } from '../../../types/conversation';
import type { Message } from '../../../types/message';
import { buildAgentControlGraphOpenWorkCloseoutDecision } from '../asyncOpenWork';
import { buildAgentControlGraphOpenWorkCloseoutEffect } from '../openWorkCloseoutEffect';
import type { ForegroundRunCompletionReviewResult } from './completionReview';
import type { ForegroundRunTrackingState } from './trackingState';

type AssistantCloseoutCandidate =
  | Pick<Message, 'role' | 'content' | 'subAgentEvent' | 'toolCalls' | 'assistantMetadata'>
  | undefined;

type AppendConversationLog = (entry: {
  title: string;
  detail?: string;
  level?: ConversationLogEntry['level'];
  kind?: ConversationLogEntry['kind'];
  timestamp?: number;
}) => void;

export function handleForegroundRunCompletionFlow(params: {
  appendConversationLog: AppendConversationLog;
  currentAssistantMessage?: AssistantCloseoutCandidate;
  currentAssistantMessageId: string;
  enterAsyncMonitoringPhase: (detail: string, checkpointTitle?: string) => void;
  finalizeCompletion: (
    completion: Extract<ForegroundRunCompletionReviewResult, { handled: false }>,
  ) => boolean;
  reviewCompletion: () => ForegroundRunCompletionReviewResult;
  forceTerminalReview?: boolean;
  trackedRunState: ForegroundRunTrackingState;
  turnSummary: string;
}) {
  if (!params.forceTerminalReview) {
    if (params.trackedRunState.awaitingUserInput) {
      const detail = 'Waiting for the user to answer the registered clarification.';
      params.enterAsyncMonitoringPhase(detail, 'Clarification requested');
      params.appendConversationLog({
        kind: 'state',
        level: 'warning',
        title: 'Clarification requested',
        detail: `${params.turnSummary} · ${detail}`,
      });
      return;
    }
    const openWorkCloseoutEffect = buildAgentControlGraphOpenWorkCloseoutEffect({
      currentAssistantMessage: params.currentAssistantMessage,
      decision: buildAgentControlGraphOpenWorkCloseoutDecision({
        backgroundWorkers: params.trackedRunState.backgroundWorkers,
        pendingOperations: params.trackedRunState.pendingAsyncOperations,
      }),
      turnSummary: params.turnSummary,
    });

    if (openWorkCloseoutEffect.type === 'async-operations') {
      params.enterAsyncMonitoringPhase(
        openWorkCloseoutEffect.phasePresentation.detail,
        openWorkCloseoutEffect.phasePresentation.checkpointTitle,
      );
      params.appendConversationLog(openWorkCloseoutEffect.logEntry);
      return;
    }

    // A turn that handed off with sessions_yield stays open for the work it is waiting on; an
    // async resume or the terminal background review continues it.
    if (params.trackedRunState.yielded) {
      const detail = 'Waiting for the work this turn handed off.';
      params.enterAsyncMonitoringPhase(detail, 'Waiting for handed-off work');
      params.appendConversationLog({
        kind: 'state',
        level: 'info',
        title: 'Waiting for handed-off work',
        detail: `${params.turnSummary} · ${detail}`,
      });
      return;
    }
  }

  const completionReview = params.reviewCompletion();
  if (completionReview.handled) {
    return;
  }

  if (!params.finalizeCompletion(completionReview)) {
    // The tracked run refused this outcome — it is no longer running, or its graph cannot
    // settle as requested. Record it: a silent refusal leaves nothing to trace when the
    // run's state and the delivered answer disagree.
    params.appendConversationLog({
      kind: 'state',
      level: 'warning',
      title: 'Run completion not applied',
      detail: `${params.turnSummary} · The run did not accept the ${completionReview.completionStatus} outcome (${completionReview.checkpointTitle}).`,
    });
    return;
  }
  params.appendConversationLog({
    kind: 'state',
    level: completionReview.completionLogLevel,
    title: completionReview.completionLogTitle,
    detail: completionReview.completionLogDetail,
  });
}
