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

export async function handleForegroundRunCompletionFlow(params: {
  appendConversationLog: AppendConversationLog;
  currentAssistantMessage?: AssistantCloseoutCandidate;
  currentAssistantMessageId: string;
  enterAsyncMonitoringPhase: (detail: string, checkpointTitle?: string) => void;
  finalizeCompletion: (
    completion: Extract<ForegroundRunCompletionReviewResult, { handled: false }>,
  ) => void;
  recordConversationTurnMemory: () => void;
  reviewCompletion: () => Promise<ForegroundRunCompletionReviewResult>;
  trackedRunState: ForegroundRunTrackingState;
  turnSummary: string;
}) {
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

  const completionReview = await params.reviewCompletion();
  if (completionReview.handled) {
    return;
  }

  params.finalizeCompletion(completionReview);
  params.appendConversationLog({
    kind: 'state',
    level: completionReview.completionLogLevel,
    title: completionReview.completionLogTitle,
    detail: completionReview.completionLogDetail,
  });
  params.recordConversationTurnMemory();
}
