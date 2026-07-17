import type { RequestClarificationToolResult } from '../../services/agents/requestClarification';
import { resolveRequestDecision } from '../../services/agents/requestDecisionPolicy';
import {
  REQUEST_FRAME_VERSION,
  type RequestFrame,
} from '../../services/agents/requestFrame';
import {
  projectRequestUnderstanding,
  summarizeRequestUnderstanding,
} from '../../services/agents/requestUnderstandingProjection';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import type { ToolCallRecord } from '../loopDetection';
import type { ToolMessageOutcome } from '../toolExecution/toolMessageOutcome';
import {
  effectReceiptEvidenceTargetsCriterion,
  parseEffectCompletionCriterion,
  parseToolEffectReceiptEvidence,
} from '../goals/effectCompletionEvidence';
import {
  isBlockingGoal,
  isCodeOwnedEffectCompletionGoal,
  type AgentGoal,
} from '../goals/types';
import type { AgentControlGraphEvent } from './agentControlGraph';
import type { CanonicalToolExecutionOutcome } from './toolExecutionOutcomeCanonicalization';

export function updateToolCallHistoryResult(params: {
  history: ToolCallRecord[] | undefined;
  toolCallId: string;
  toolName: string;
  argumentsText: string | undefined;
  result: string;
  status: ToolMessageOutcome['status'];
}): void {
  if (!params.history) return;

  for (let index = params.history.length - 1; index >= 0; index -= 1) {
    const entry = params.history[index];
    const idMatches = entry?.id && entry.id === params.toolCallId;
    const callMatches =
      !entry?.id &&
      entry?.name === params.toolName &&
      entry.arguments === (params.argumentsText ?? '{}');
    if (!entry || (!idMatches && !callMatches)) continue;

    params.history[index] = {
      ...entry,
      result: params.result,
      status: params.status,
    };
    return;
  }
}

export function buildDeferredAfterGraphMutationOutcome(
  outcome: CanonicalToolExecutionOutcome,
): CanonicalToolExecutionOutcome {
  const toolName = outcome.toolMessage.toolCalls?.[0]?.name || outcome.toolCallId;
  const content = JSON.stringify(
    {
      status: 'deferred',
      reason: 'graph_mutation_boundary',
      tool: toolName,
    },
    null,
    2,
  );

  return {
    ...outcome,
    skipWorkflowProgress: true,
    toolMessage: {
      ...outcome.toolMessage,
      content,
      isError: false,
      toolCalls: outcome.toolMessage.toolCalls?.map((toolCall) =>
        toolCall.id === outcome.toolCallId
          ? { ...toolCall, result: content, status: 'completed' as const, error: undefined }
          : { ...toolCall },
      ),
    },
  };
}

export function collectCompletedBlockingGoalIds(
  goals: ReadonlyArray<AgentGoal> | undefined,
): Set<string> {
  return new Set(
    (goals ?? [])
      .filter((goal) => isBlockingGoal(goal) && goal.status === 'completed')
      .map((goal) => goal.id),
  );
}

export function hasNewlyCompletedBlockingGoal(params: {
  before: ReadonlySet<string>;
  after: ReadonlyArray<AgentGoal> | undefined;
}): boolean {
  return (params.after ?? []).some(
    (goal) =>
      isBlockingGoal(goal) &&
      !isCodeOwnedEffectCompletionGoal(goal) &&
      goal.status === 'completed' &&
      !params.before.has(goal.id),
  );
}

export function buildTerminalFailedEffectGuardRemovalEvent(params: {
  goals: ReadonlyArray<AgentGoal>;
  receiptEvidence: string | undefined;
}): AgentControlGraphEvent | null {
  const receipt = params.receiptEvidence
    ? parseToolEffectReceiptEvidence(params.receiptEvidence)
    : null;
  if (!receipt || (receipt.effectState !== 'failed' && receipt.effectState !== 'cancelled')) {
    return null;
  }

  const removableGoalIds = new Set(
    params.goals
      .filter(
        (goal) =>
          isCodeOwnedEffectCompletionGoal(goal) &&
          (goal.status === 'active' || goal.status === 'blocked') &&
          (goal.successCriteria ?? []).some((criterion) => {
            const effectCriterion = parseEffectCompletionCriterion(criterion);
            return effectCriterion
              ? effectReceiptEvidenceTargetsCriterion(receipt, effectCriterion)
              : false;
          }),
      )
      .map((goal) => goal.id),
  );
  if (removableGoalIds.size === 0) return null;

  return {
    type: 'GOALS_UPDATED',
    goals: params.goals.filter((goal) => !removableGoalIds.has(goal.id)),
    reason: 'effect_completion_contract:terminal_failed_retired',
    projectToMemoryTasks: false,
    timestamp: Date.now(),
  };
}

export function buildAppliedUnverifiedEffectGoalBlockEvent(params: {
  goals: ReadonlyArray<AgentGoal>;
  receiptEvidence: string | undefined;
}): AgentControlGraphEvent | null {
  const receipt = params.receiptEvidence
    ? parseToolEffectReceiptEvidence(params.receiptEvidence)
    : null;
  if (!receipt || receipt.effectState !== 'applied' || receipt.verificationState === 'verified') {
    return null;
  }

  const timestamp = Date.now();
  const targetGoalIds = new Set(
    params.goals
      .filter(
        (goal) =>
          goal.status === 'active' &&
          (goal.successCriteria ?? []).some((criterion) => {
            const effectCriterion = parseEffectCompletionCriterion(criterion);
            return effectCriterion
              ? effectReceiptEvidenceTargetsCriterion(receipt, effectCriterion)
              : false;
          }),
      )
      .map((goal) => goal.id),
  );
  if (targetGoalIds.size === 0) return null;

  return {
    type: 'GOALS_UPDATED',
    goals: params.goals.map((goal) =>
      targetGoalIds.has(goal.id)
        ? {
            ...goal,
            status: 'blocked' as const,
            blockedReason: `Effect applied but verification was incomplete (${receipt.receiptId}). Do not repeat the mutation.`,
            updatedAt: timestamp,
          }
        : goal,
    ),
    reason: 'effect_verification_incomplete',
    timestamp,
  };
}

export function buildClarificationRequestUnderstanding(params: {
  graphSnapshot: AgentRunControlGraphState;
  request: RequestClarificationToolResult;
}) {
  const routing = params.graphSnapshot.requestUnderstanding?.routing;
  if (!routing || routing.status !== 'known') return undefined;

  const baseFrame: RequestFrame = {
    version: REQUEST_FRAME_VERSION,
    mode: routing.mode,
    input: {
      kind: routing.inputKind,
      attachmentCount: routing.attachmentCount,
    },
    continuation: routing.continuation,
    requiredInformation: [],
    decision: {
      action: 'act',
      reason: 'actionable_input',
    },
  };
  const clarificationFrame = resolveRequestDecision({
    frame: baseFrame,
    requiredInformation: params.request.requiredInformation,
    policyDisposition: 'allowed',
    permissionState: 'not_required',
    awaitingExternalOperation: false,
  });
  return summarizeRequestUnderstanding(
    projectRequestUnderstanding({
      requestFrame: clarificationFrame,
      goals: params.graphSnapshot.goals,
    }),
  );
}
