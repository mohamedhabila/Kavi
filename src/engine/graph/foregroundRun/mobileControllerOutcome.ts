import { qualifyMobileControllerOutcome } from '../../mobileController/validation';
import type { MobileControllerOutcomeSettlementResult } from '../../../services/executionJournal/mobileControllerOutcomeStore';
import { settleMobileControllerOutcome } from '../../../services/executionJournal/mobileControllerOutcomeStore';
import { getAgentRunPendingAsyncOperations } from '../../../services/agents/agentRunAsyncState';
import { qualifyAgentRunMobileControllerHandoffRef } from '../../../services/agents/mobileControllerAsyncOperation';
import type { Conversation } from '../../../types/conversation';
import type { ChatState } from '../../../store/chatStoreTypes';
import type { RunChatOptions } from './contracts';
import type { ExecuteForegroundConversationRunParams } from './executionTypes';
import { qualifyMobileControllerObservationRef } from '../../mobileController/validation';
import { MOBILE_UI_ACTION_TOOL_NAME } from '../../mobileController/contracts';

export type ForegroundMobileControllerOutcomePreparation =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'applied'; conversation: Conversation }>
  | Readonly<{ kind: 'replayed' }>
  | Readonly<{
      kind: 'rejected';
      reason:
        | 'owner_missing'
        | 'pending_handoff_missing'
        | 'outcome_invalid'
        | 'observation_mismatch'
        | 'journal_settlement_failed'
        | 'chat_projection_failed'
        | 'chat_persistence_failed';
    }>;

type SettleMobileControllerOutcome = typeof settleMobileControllerOutcome;

export type ForegroundMobileControllerOutcomeGate =
  | Readonly<{ kind: 'continue'; conversation: Conversation | undefined }>
  | Readonly<{ kind: 'stop' }>;

function hasRecordedOutcome(
  conversation: Conversation | undefined,
  handoff: NonNullable<ReturnType<typeof qualifyAgentRunMobileControllerHandoffRef>>,
): boolean {
  const ownedCalls = (conversation?.messages ?? []).flatMap((message) =>
    message.role === 'assistant'
      ? (message.toolCalls ?? [])
          .filter(
            (call) =>
              call.id === handoff.toolCallId && call.name === MOBILE_UI_ACTION_TOOL_NAME,
          )
          .map((call) => ({ message, call }))
      : [],
  );
  const results = (conversation?.messages ?? []).filter(
    (message) => message.role === 'tool' && message.toolCallId === handoff.toolCallId,
  );
  const owned = ownedCalls[0];
  const result = results[0];
  return (
    ownedCalls.length === 1 &&
    results.length === 1 &&
    Boolean(owned) &&
    Boolean(result) &&
    result?.id === `${owned?.message.id}_tool_${handoff.toolCallId}` &&
    owned?.call.result === result?.content &&
    ['completed', 'failed'].includes(owned?.call.status ?? '') &&
    (owned?.call.effectReceipts?.length ?? 0) > 0
  );
}

export async function prepareForegroundMobileControllerOutcome(params: {
  conversation: Conversation | undefined;
  conversationId: string;
  options: RunChatOptions | undefined;
  applyOutcome: ChatState['applyMobileControllerOutcome'];
  flushChatState: () => Promise<void>;
  getConversation: (conversationId: string) => Conversation | undefined;
  settleOutcome?: SettleMobileControllerOutcome;
}): Promise<ForegroundMobileControllerOutcomePreparation> {
  const submission = params.options?.mobileControllerOutcome;
  if (!submission) return { kind: 'absent' };
  const outcome = qualifyMobileControllerOutcome(submission.outcome);
  const submittedHandoff = qualifyAgentRunMobileControllerHandoffRef(submission.handoff);
  if (!outcome || !submittedHandoff) {
    return { kind: 'rejected', reason: 'outcome_invalid' };
  }

  const runId = params.options?.reuseAgentRunId?.trim();
  const run = runId ? params.conversation?.agentRuns?.find((candidate) => candidate.id === runId) : undefined;
  if (!runId || !run) {
    return { kind: 'rejected', reason: 'owner_missing' };
  }
  const replayCandidate = hasRecordedOutcome(params.conversation, submittedHandoff);
  if (!replayCandidate && run.status !== 'running') {
    return { kind: 'rejected', reason: 'owner_missing' };
  }
  const operations = getAgentRunPendingAsyncOperations(run);
  const operation = operations.length === 1 ? operations[0] : undefined;
  const pendingHandoff = operation?.mobileControllerHandoff;
  const exactPendingHandoff =
    operation?.kind === 'mobile-controller-handoff' &&
    operation.status === 'running' &&
    pendingHandoff &&
    JSON.stringify(pendingHandoff) === JSON.stringify(submittedHandoff);
  if (!exactPendingHandoff && !replayCandidate) {
    return { kind: 'rejected', reason: 'pending_handoff_missing' };
  }
  const controller = params.options?.mobileController;
  const currentObservation = controller
    ? qualifyMobileControllerObservationRef(controller.currentObservation)
    : null;
  if (
    outcome.afterObservation &&
    controller &&
    !replayCandidate &&
    (!currentObservation ||
      JSON.stringify(currentObservation) !== JSON.stringify(outcome.afterObservation))
  ) {
    return { kind: 'rejected', reason: 'observation_mismatch' };
  }

  let settlement: MobileControllerOutcomeSettlementResult;
  try {
    settlement = await (params.settleOutcome ?? settleMobileControllerOutcome)({
      handoff: submittedHandoff,
      outcome,
      receivedAt: Date.now(),
    });
  } catch {
    return { kind: 'rejected', reason: 'journal_settlement_failed' };
  }
  const projection = params.applyOutcome(params.conversationId, {
    runId,
    handoff: settlement.handoff,
    receipt: settlement.receipt,
    toolMessage: settlement.toolMessage,
    settledAt: settlement.settledAt,
  });
  if (projection.status === 'replayed') return { kind: 'replayed' };
  if (projection.status !== 'applied') {
    return { kind: 'rejected', reason: 'chat_projection_failed' };
  }
  try {
    await params.flushChatState();
  } catch {
    return { kind: 'rejected', reason: 'chat_persistence_failed' };
  }
  const conversation = params.getConversation(params.conversationId);
  return conversation
    ? { kind: 'applied', conversation }
    : { kind: 'rejected', reason: 'chat_projection_failed' };
}

/** Own the foreground stop/error semantics around outcome preparation. */
export async function resolveForegroundMobileControllerOutcomeGate(params: {
  context: ExecuteForegroundConversationRunParams['context'];
  conversation: Conversation | undefined;
  conversationId: string;
  options: RunChatOptions | undefined;
  clearForegroundRequestIfCurrent: () => boolean;
}): Promise<ForegroundMobileControllerOutcomeGate> {
  const preparation = await prepareForegroundMobileControllerOutcome({
    conversation: params.conversation,
    conversationId: params.conversationId,
    options: params.options,
    applyOutcome: params.context.store.applyMobileControllerOutcome,
    flushChatState: params.context.durability.flushChatState,
    getConversation: params.context.helpers.getConversation,
  });
  if (preparation.kind === 'rejected') {
    if (params.clearForegroundRequestIfCurrent()) {
      params.context.helpers.setChatError(
        `Mobile action outcome could not be applied safely (${preparation.reason}).`,
      );
    }
    return { kind: 'stop' };
  }
  if (preparation.kind === 'replayed') {
    params.clearForegroundRequestIfCurrent();
    return { kind: 'stop' };
  }
  return {
    kind: 'continue',
    conversation:
      preparation.kind === 'applied' ? preparation.conversation : params.conversation,
  };
}
