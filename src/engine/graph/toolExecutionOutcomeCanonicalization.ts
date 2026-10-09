import type { AgentGoal, AgentRunControlGraphState } from '../../types/agentRun';
import type { Message } from '../../types/message';
import {
  areGoalSuccessCriteriaSatisfied,
  isCountOnlySuccessCriterion,
  isSuccessCriterionMet,
} from '../goals/completionEvidence';
import { buildToolGoalEvidenceStrings } from '../goals/toolEvidence';
import { applyGoalMutation, normalizeGoalMutationForApplication } from '../goals/graphState';
import { parseToolArgumentsJson } from '../toolExecution/toolArgumentJsonRecovery';
import {
  getGoalById,
  isBlockingGoal,
  resolveGoalCompletionPolicy,
  type AgentGoalMutation,
} from '../goals/types';
import { serializeGoalMutationToolErrors } from '../goals/mutationErrors';
import { validateGoalMutation, validateGoalReferences } from '../goals/validation';
import { parseUpdateGoalsArgs } from '../tools/toolGoalExecution';
import { syncGoalTasksFromMutation } from '../../services/memory/tasks';
import type { AgentControlGraphEvent } from './agentControlGraph';
import type { TerminalToolExecutionOutcome } from './toolExecutionOutcomeResolution';
import type { ToolCallRecord } from '../loopDetection';
import type { CodeOwnedCurrentUserMessage } from '../tools/toolExecutionContext';
import { resolveGoalCapabilityToolNames } from '../goals/toolSurface';
import { TOOL_DEFINITIONS } from '../tools/definitions';
import { REQUEST_CLARIFICATION_TOOL_NAME } from '../../services/agents/requestClarification';
import {
  buildCanonicalUpdateGoalsContent,
  GOALLESS_UPDATE_GOALS_NOTE,
  serializeParsedUpdateGoalsErrors,
} from './updateGoalsCanonicalContent';

export type CanonicalToolExecutionOutcome = TerminalToolExecutionOutcome & {
  canonicalized: boolean;
  graphApplied: boolean;
};

/**
 * Whether canonical content records a rejected mutation.
 *
 * The executor returns `completed` for any call whose arguments parsed, and rejection
 * happens later here, against the graph. Only `result` was rewritten, so a refused
 * mutation stayed a completed tool call everywhere its status is read.
 *
 * Traced on-device: two of the first four update_goals calls in a run were rejected for
 * an unregistered evidence.prefix token, and both were displayed — and tallied — as
 * completed. The corrections that followed then read as gratuitous duplicate calls
 * rather than as repairs, which is the wrong diagnosis of a healthy recovery.
 */
function recordsRejectedMutation(content: string): boolean {
  if (!content.includes('"status"')) {
    return false;
  }

  try {
    const parsed = JSON.parse(content);
    return (
      typeof parsed === 'object' && parsed !== null && (parsed as { status?: unknown }).status === 'error'
    );
  } catch {
    return false;
  }
}

function cloneToolMessageWithContent(message: Message, content: string): Message {
  const status = recordsRejectedMutation(content) ? ('failed' as const) : undefined;

  return {
    ...message,
    content,
    toolCalls: message.toolCalls?.map((toolCall) =>
      toolCall.id === message.toolCallId
        ? { ...toolCall, result: content, ...(status ? { status } : {}) }
        : { ...toolCall },
    ),
  };
}

function cloneToolExecutionOutcomeWithContent(
  outcome: TerminalToolExecutionOutcome,
  content: string,
): TerminalToolExecutionOutcome {
  return {
    ...outcome,
    toolMessage: cloneToolMessageWithContent(outcome.toolMessage, content),
  };
}

function isStalePersistentActivation(params: {
  mutation: AgentGoalMutation;
  snapshot: AgentRunControlGraphState;
}): boolean {
  if (params.mutation.action !== 'activate') {
    return false;
  }

  const goals = params.snapshot.goals ?? [];
  return params.mutation.goals.some((goalPatch) => {
    const targetId = goalPatch.id?.trim();
    if (!targetId) {
      return false;
    }
    const target = getGoalById(goals, targetId);
    if (
      !target ||
      target.status === 'active' ||
      resolveGoalCompletionPolicy(target) !== 'persistent'
    ) {
      return false;
    }

    return goals.some(
      (goal) =>
        goal.id !== target.id &&
        goal.status === 'active' &&
        resolveGoalCompletionPolicy(goal) === 'persistent' &&
        goal.createdAt > target.createdAt,
    );
  });
}

function collectGraphEvidence(goals: ReadonlyArray<AgentGoal>): string[] {
  return Array.from(new Set(goals.flatMap((goal) => goal.evidence ?? [])));
}

function collectObservedToolEvidence(snapshot: AgentRunControlGraphState): string[] {
  return Array.from(
    new Set(
      (snapshot.observedToolResults ?? [])
        .filter((result) => !result.failed && result.name !== 'update_goals')
        .flatMap((result) => [
          ...(result.evidence ?? []),
          `${result.name}:observed_result:${result.id}`,
        ]),
    ),
  );
}

function collectToolHistoryEvidence(history: ReadonlyArray<ToolCallRecord> | undefined): string[] {
  return Array.from(
    new Set(
      (history ?? [])
        .filter(
          (entry) =>
            entry.name !== 'update_goals' &&
            entry.status === 'completed' &&
            typeof entry.result === 'string' &&
            entry.result.length > 0,
        )
        .flatMap((entry) => [
          ...buildToolGoalEvidenceStrings({
            toolName: entry.name,
            content: entry.result ?? '',
          }),
          ...(entry.id ? [`${entry.name}:observed_result:${entry.id}`] : []),
        ]),
    ),
  );
}

function criteriaMatchEvidence(criteria: ReadonlyArray<string>, evidence: string): boolean {
  if (criteria.length === 0) {
    return false;
  }

  const hypotheticalGoal: AgentGoal = {
    id: 'candidate',
    title: 'candidate',
    status: 'active',
    dependencies: [],
    evidence: [evidence],
    createdAt: 0,
    updatedAt: 0,
    successCriteria: [...criteria],
    completionPolicy: 'blocking',
  };
  return criteria.some(
    (criterion) =>
      !isCountOnlySuccessCriterion(criterion) && isSuccessCriterionMet(hypotheticalGoal, criterion),
  );
}

function reconcileMutationEvidenceFromGraph(params: {
  mutation: AgentGoalMutation;
  snapshot: AgentRunControlGraphState;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
}): AgentGoalMutation {
  if (params.mutation.action !== 'add' && params.mutation.action !== 'update') {
    return params.mutation;
  }

  const evidencePool = [
    ...collectGraphEvidence(params.snapshot.goals ?? []),
    ...collectObservedToolEvidence(params.snapshot),
    ...collectToolHistoryEvidence(params.toolCallHistory),
  ];
  if (evidencePool.length === 0) {
    return params.mutation;
  }

  let changed = false;
  const goals = params.mutation.goals.map((patch) => {
    const existingGoal = patch.id ? getGoalById(params.snapshot.goals ?? [], patch.id) : undefined;
    const criteria = patch.successCriteria ?? existingGoal?.successCriteria ?? [];
    const matchingEvidence = evidencePool.filter((evidence) =>
      criteriaMatchEvidence(criteria, evidence),
    );
    if (matchingEvidence.length === 0) {
      return patch;
    }

    const evidence = Array.from(new Set([...(patch.evidence ?? []), ...matchingEvidence]));
    if (evidence.length === (patch.evidence ?? []).length) {
      return patch;
    }
    changed = true;
    return {
      ...patch,
      evidence,
    };
  });

  return changed ? { ...params.mutation, goals } : params.mutation;
}

function buildAutoCompletedSatisfiedGoals(
  goals: ReadonlyArray<AgentGoal>,
  now: number = Date.now(),
): AgentGoal[] {
  const satisfiedBlockingGoalIds = new Set(
    goals
      .filter(
        (goal) =>
          (goal.status === 'active' || goal.status === 'blocked') &&
          goal.userConstraintIntegrity !== 'conflict' &&
          isBlockingGoal(goal) &&
          (goal.successCriteria?.length ?? 0) > 0 &&
          areGoalSuccessCriteriaSatisfied(goal),
      )
      .map((goal) => goal.id),
  );
  if (satisfiedBlockingGoalIds.size === 0) {
    return goals.map((goal) => ({ ...goal }));
  }

  return goals.map((goal) =>
    satisfiedBlockingGoalIds.has(goal.id)
      ? {
          ...goal,
          status: 'completed' as const,
          updatedAt: now,
          completedAt: now,
          blockedReason: undefined,
          ...((goal.userConstraints?.length ?? 0) > 0
            ? { userConstraintDeliveryPending: true as const }
            : {}),
        }
      : { ...goal },
  );
}

export function canonicalizeToolExecutionOutcome(params: {
  outcome: TerminalToolExecutionOutcome;
  toolName: string;
  executableToolCalls: ReadonlyArray<{ name: string; arguments: string }>;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
  getGraphSnapshot: () => AgentRunControlGraphState;
  applyGraphEvents: (events: ReadonlyArray<AgentControlGraphEvent>) => void;
  conversationId: string;
  currentUserMessage?: CodeOwnedCurrentUserMessage;
  warn: (message: string, error: unknown) => void;
}): CanonicalToolExecutionOutcome {
  if (params.toolName !== 'update_goals') {
    return {
      ...params.outcome,
      canonicalized: false,
      graphApplied: false,
    };
  }

  const originalCall = params.executableToolCalls[params.outcome.index];
  if (!originalCall) {
    return {
      ...params.outcome,
      canonicalized: false,
      graphApplied: false,
    };
  }

  try {
    /**
     * This is the authoritative parse for a goal mutation, so the dropped-brace recovery
     * has to run here too. Wiring it only into the tool executors left this path on plain
     * JSON.parse, and a traced run died here: two update_goals calls carrying
     * `"goals": ["id": ...]` were answered "JSON Parse error: Unexpected character: :"
     * and the run stopped for repeating a step without progress. The recovery existed and
     * simply was not reached.
     */
    const args = parseToolArgumentsJson(originalCall.arguments || '{}') as Record<
      string,
      unknown
    >;
    const parsed = parseUpdateGoalsArgs(args);
    const currentGoals = params.getGraphSnapshot().goals ?? [];
    if (parsed.errors.length > 0) {
      const content = buildCanonicalUpdateGoalsContent({
        status: 'error',
        action: parsed.mutation.action,
        // A rejected mutation reports what went wrong but used to omit what is
        // actually true, so the model retried against its own stale picture of the
        // goal list — one rejection became a loop. Returning current state with every
        // error lets it see reality and adapt instead of guessing.
        goals: currentGoals,
        errors: parsed.errors.map((error) => error.message),
        structuredErrors: serializeParsedUpdateGoalsErrors(parsed.errors, args),
        attemptedArguments: args,
      });
      return {
        ...cloneToolExecutionOutcomeWithContent(params.outcome, content),
        canonicalized: true,
        graphApplied: false,
      };
    }

    // Argument-level update_goals failures are canonicalized above so the model receives the
    // graph-specific repair contract. Never apply an otherwise-valid mutation when execution
    // itself failed for another reason.
    if (params.outcome.toolMessage.isError) {
      return {
        ...params.outcome,
        canonicalized: false,
        graphApplied: false,
      };
    }

    if (parsed.mutation.goals.length === 0) {
      const content = buildCanonicalUpdateGoalsContent({
        status: 'ok',
        action: parsed.mutation.action,
        goals: currentGoals,
        note: GOALLESS_UPDATE_GOALS_NOTE,
      });
      return {
        ...cloneToolExecutionOutcomeWithContent(params.outcome, content),
        canonicalized: true,
        graphApplied: false,
      };
    }

    const snapshot = params.getGraphSnapshot();
    const reconciledMutation = reconcileMutationEvidenceFromGraph({
      mutation: parsed.mutation,
      snapshot,
      toolCallHistory: params.toolCallHistory,
    });
    const mutation = normalizeGoalMutationForApplication(snapshot.goals ?? [], reconciledMutation);
    if (
      isStalePersistentActivation({
        mutation,
        snapshot,
      })
    ) {
      const currentGoals = snapshot.goals ?? [];
      params.applyGraphEvents([
        {
          type: 'GOALS_UPDATED',
          goals: currentGoals,
          reason: `update_goals:${mutation.action}:stale_persistent_noop`,
          timestamp: Date.now(),
        },
      ]);
      const content = buildCanonicalUpdateGoalsContent({
        status: 'ok',
        action: mutation.action,
        goals: currentGoals,
      });
      return {
        ...cloneToolExecutionOutcomeWithContent(params.outcome, content),
        canonicalized: true,
        graphApplied: true,
      };
    }

    // Abandoning a blocking goal is gated on evidence that every available path was
    // tried, so the validator needs this run's attempts and the capability tools the
    // active surface still exposes.
    const activeBlockingGoals = (snapshot.goals ?? []).filter(
      (goal) => goal.status === 'active' && isBlockingGoal(goal),
    );
    const activatedToolNames = new Set(snapshot.sessionActivatedToolNames ?? []);
    const capabilityToolNames = resolveGoalCapabilityToolNames(
      activeBlockingGoals,
      TOOL_DEFINITIONS,
    ).filter((toolName) => activatedToolNames.size === 0 || activatedToolNames.has(toolName));
    const validationContext = {
      currentUserMessage: params.currentUserMessage,
      toolCallHistory: params.toolCallHistory,
      capabilityToolNames,
      clarificationToolName: activatedToolNames.has(REQUEST_CLARIFICATION_TOOL_NAME)
        ? REQUEST_CLARIFICATION_TOOL_NAME
        : undefined,
    };
    const { goals: nextGoals, errors } = applyGoalMutation(
      snapshot.goals ?? [],
      mutation,
      Date.now(),
      validationContext,
    );
    if (errors.length > 0) {
      const validation = validateGoalMutation(mutation, snapshot.goals ?? [], validationContext);
      const content = buildCanonicalUpdateGoalsContent({
        status: 'error',
        action: mutation.action,
        goals: snapshot.goals ?? currentGoals,
        errors,
        structuredErrors: serializeGoalMutationToolErrors(validation.errors),
        attemptedArguments: args,
      });
      return {
        ...cloneToolExecutionOutcomeWithContent(params.outcome, content),
        canonicalized: true,
        graphApplied: false,
      };
    }

    const finalGoals = buildAutoCompletedSatisfiedGoals(nextGoals);
    const referenceValidation = validateGoalReferences(finalGoals);
    if (!referenceValidation.valid) {
      const content = buildCanonicalUpdateGoalsContent({
        status: 'error',
        action: parsed.mutation.action,
        goals: finalGoals,
        errors: referenceValidation.errors.map((entry) =>
          entry.goalId ? `[${entry.goalId}] ${entry.message}` : entry.message,
        ),
        structuredErrors: serializeGoalMutationToolErrors(referenceValidation.errors),
        attemptedArguments: args,
      });
      return {
        ...cloneToolExecutionOutcomeWithContent(params.outcome, content),
        canonicalized: true,
        graphApplied: false,
      };
    }

    params.applyGraphEvents([
      {
        type: 'GOALS_UPDATED',
        goals: finalGoals,
        reason: `update_goals:${mutation.action}`,
        timestamp: Date.now(),
      },
    ]);
    try {
      syncGoalTasksFromMutation({
        threadId: params.conversationId,
        mutation,
        goals: finalGoals,
      });
    } catch {
      // Best-effort memory task sync; graph update must not fail.
    }

    const content = buildCanonicalUpdateGoalsContent({
      status: 'ok',
      action: mutation.action,
      goals: finalGoals,
    });
    return {
      ...cloneToolExecutionOutcomeWithContent(params.outcome, content),
      canonicalized: true,
      graphApplied: true,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    params.warn(`update_goals handling failed for ${params.outcome.toolCallId}`, err);
    const content = JSON.stringify({ status: 'error', errors: [message] }, null, 2);
    return {
      ...cloneToolExecutionOutcomeWithContent(params.outcome, content),
      canonicalized: true,
      graphApplied: false,
    };
  }
}
