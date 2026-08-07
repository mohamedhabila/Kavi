import type { AgentGoal, AgentRunControlGraphState } from '../../types/agentRun';
import type { Message } from '../../types/message';
import {
  areGoalSuccessCriteriaSatisfied,
  formatModelAuthoredSuccessCriteriaFormsDescription,
  isCountOnlySuccessCriterion,
  isSuccessCriterionMet,
} from '../goals/completionEvidence';
import { buildToolGoalEvidenceStrings } from '../goals/toolEvidence';
import { findUnmetCompletionCriteria } from '../goals/completionRefusalMessage';
import { applyGoalMutation, normalizeGoalMutationForApplication } from '../goals/graphState';
import {
  getGoalById,
  isBlockingGoal,
  resolveGoalCompletionPolicy,
  type AgentGoalMutation,
} from '../goals/types';
import { serializeGoalMutationToolErrors } from '../goals/mutationErrors';
import { validateGoalMutation, validateGoalReferences } from '../goals/validation';
import { parseUpdateGoalsArgs, type UpdateGoalsArgumentError } from '../tools/toolGoalExecution';
import { syncGoalTasksFromMutation } from '../../services/memory/tasks';
import type { AgentControlGraphEvent } from './agentControlGraph';
import type { TerminalToolExecutionOutcome } from './toolExecutionOutcomeResolution';
import type { ToolCallRecord } from '../loopDetection';
import type { CodeOwnedCurrentUserMessage } from '../tools/toolExecutionContext';
import { resolveGoalCapabilityToolNames } from '../goals/toolSurface';
import { TOOL_DEFINITIONS } from '../tools/definitions';
import { REQUEST_CLARIFICATION_TOOL_NAME } from '../../services/agents/requestClarification';
import { buildCanonicalGoalResult } from './canonicalGoalResult';

export type CanonicalToolExecutionOutcome = TerminalToolExecutionOutcome & {
  canonicalized: boolean;
  graphApplied: boolean;
};

function cloneToolMessageWithContent(message: Message, content: string): Message {
  return {
    ...message,
    content,
    toolCalls: message.toolCalls?.map((toolCall) =>
      toolCall.id === message.toolCallId ? { ...toolCall, result: content } : { ...toolCall },
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

/**
 * Compact goal state for a rejected mutation.
 *
 * A rejection needs to tell the model what is actually true so it can adapt instead of
 * retrying against a stale picture — but it does not need the evidence itself. Evidence
 * entries are effect receipts, roughly a kilobyte of digests each, and echoing the full
 * array back on every rejection inflated error responses enough to dominate a run's
 * token cost. Status and the criteria still outstanding are what the model can act on.
 */
function buildRejectedMutationGoalState(goal: AgentGoal): Record<string, unknown> {
  const unmetCriteria = findUnmetCompletionCriteria(goal);
  return {
    id: goal.id,
    status: goal.status,
    completionPolicy: goal.completionPolicy,
    evidenceCount: goal.evidence.length,
    ...(unmetCriteria.length ? { unmetCriteria } : {}),
    ...(goal.blockedReason ? { blockedReason: goal.blockedReason } : {}),
  };
}

function buildCanonicalUpdateGoalsContent(params: {
  status: 'ok' | 'error';
  action?: string;
  goals?: ReadonlyArray<AgentGoal>;
  errors?: ReadonlyArray<string>;
  structuredErrors?: ReadonlyArray<Record<string, unknown>>;
  attemptedArguments?: unknown;
}): string {
  const repair = buildUpdateGoalsRepair(params);
  return JSON.stringify(
    {
      status: params.status,
      ...(params.action ? { action: params.action } : {}),
      ...(params.goals
        ? {
            goals: params.goals.map(
              params.status === 'error' ? buildRejectedMutationGoalState : buildCanonicalGoalResult,
            ),
          }
        : {}),
      ...(params.errors ? { errors: params.errors } : {}),
      ...(params.structuredErrors ? { structuredErrors: params.structuredErrors } : {}),
      ...(repair ? { repair } : {}),
    },
    null,
    2,
  );
}

function serializeParsedUpdateGoalsErrors(
  errors: ReadonlyArray<UpdateGoalsArgumentError>,
  args: unknown,
): Array<Record<string, unknown>> {
  const goalId =
    args && typeof args === 'object' && typeof (args as Record<string, unknown>).id === 'string'
      ? ((args as Record<string, unknown>).id as string).trim()
      : '';
  return errors.map((error) => ({
    ...(goalId ? { goalId } : {}),
    code: error.code,
    ...(error.field ? { field: error.field } : {}),
    message: error.message,
  }));
}

function buildUpdateGoalsRepair(params: {
  status: 'ok' | 'error';
  action?: string;
  structuredErrors?: ReadonlyArray<Record<string, unknown>>;
  attemptedArguments?: unknown;
}): Record<string, unknown> | undefined {
  if (params.status !== 'error') {
    return undefined;
  }

  const codes = new Set(
    (params.structuredErrors ?? [])
      .map((entry) => (typeof entry.code === 'string' ? entry.code.trim() : ''))
      .filter(Boolean),
  );
  const code = Array.from(codes)[0];
  const attemptedArguments =
    params.attemptedArguments &&
    typeof params.attemptedArguments === 'object' &&
    !Array.isArray(params.attemptedArguments)
      ? (params.attemptedArguments as Record<string, unknown>)
      : undefined;
  const attemptedSuccessCriteria = Array.isArray(attemptedArguments?.successCriteria)
    ? attemptedArguments.successCriteria.filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];
  const hasSuccessCriteriaError =
    codes.has('missing_success_criteria') ||
    codes.has('weak_success_criteria') ||
    codes.has('invalid_success_criteria');
  const goalWasNotFound = codes.has('goal_not_found');
  const missingFields = [
    ...(codes.has('missing_title') ? ['name'] : []),
    ...(codes.has('missing_completion_policy') ? ['completionPolicy'] : []),
    ...(codes.has('missing_success_criteria') ? ['successCriteria'] : []),
  ];
  const invalidFields = hasSuccessCriteriaError ? ['successCriteria'] : [];
  const missingFieldLocations = buildGoalMissingFieldLocations(params.structuredErrors);
  const action = params.action ?? 'add';
  const expectedShape =
    action === 'add'
      ? {
          action: 'add',
          id: '<stable-goal-id>',
          name: '<visible-goal-name>',
          completionPolicy: 'blocking|persistent',
          status: 'pending|active',
          ...(hasSuccessCriteriaError
            ? { successCriteria: ['<specific-structural-success-criterion>'] }
            : {}),
        }
      : {
          action,
          id: '<existing-goal-id>',
        };

  return {
    retryable: true,
    ...(code ? { code } : {}),
    sideEffectApplied: false,
    expectedShape,
    fieldPlacement: 'Put goal fields at the root of the update_goals arguments object.',
    valueSource:
      'Replace angle-bracket templates with exact values from the user request, current goals, or prior tool results; never send template text literally.',
    ...(missingFields.length > 0 ? { missingFields } : {}),
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
    ...(missingFieldLocations.length > 0 ? { missingFieldLocations } : {}),
    ...(missingFieldLocations.length > 0
      ? { retryTemplate: buildGoalRetrySkeleton(action, missingFieldLocations) }
      : {}),
    ...(hasSuccessCriteriaError
      ? {
          successCriteriaContract: {
            acceptedForms: formatModelAuthoredSuccessCriteriaFormsDescription(),
            specificityRule:
              'A blocking goal needs at least one specific criterion; evidence.min and evidence.count may supplement it but cannot stand alone.',
            workspaceArtifactRule:
              'For each required workspace file use evidence.artifact:<exact-workspace-relative-path>. Never use evidence.prefix:artifact.',
            prefixRule:
              'evidence.prefix:<token> accepts only a registered tool evidence source or the registered worker prefix.',
          },
          ...(attemptedSuccessCriteria.length > 0 ? { attemptedSuccessCriteria } : {}),
        }
      : {}),
    ...(goalWasNotFound
      ? {
          goalNotFoundRepair: {
            instruction:
              'This mutation was not applied. If this id belongs to a new goal or an earlier add failed, retry with action add and the full add fields. Otherwise retry the intended action with an id from the current goal graph.',
            addShape: {
              action: 'add',
              id: '<stable-goal-id>',
              name: '<visible-goal-name>',
              completionPolicy: 'blocking|persistent',
              status: 'pending|active',
              successCriteria: ['<required-for-blocking-only>'],
            },
          },
        }
      : {}),
  };
}

function buildGoalMissingFieldLocations(
  structuredErrors: ReadonlyArray<Record<string, unknown>> | undefined,
): Array<{ goalId: string; field: string; path: string }> {
  const locations: Array<{ goalId: string; field: string; path: string }> = [];
  for (const error of structuredErrors ?? []) {
    const goalId = typeof error.goalId === 'string' ? error.goalId.trim() : '';
    if (!goalId) {
      continue;
    }

    if (error.code === 'missing_title') {
      locations.push({ goalId, field: 'name', path: 'name' });
    }
    if (error.code === 'missing_completion_policy') {
      locations.push({
        goalId,
        field: 'completionPolicy',
        path: 'completionPolicy',
      });
    }
    if (error.code === 'missing_success_criteria') {
      locations.push({
        goalId,
        field: 'successCriteria',
        path: 'successCriteria',
      });
    }
  }
  return locations;
}

function buildGoalRetrySkeleton(
  action: string,
  locations: ReadonlyArray<{ goalId: string; field: string }>,
): Record<string, unknown> {
  const skeleton: Record<string, unknown> = { action };
  for (const location of locations) {
    if (!skeleton.id) {
      skeleton.id = location.goalId;
    }
    if (location.field === 'name') {
      skeleton.name = '<visible-goal-name>';
    }
    if (location.field === 'completionPolicy') {
      skeleton.completionPolicy = 'blocking|persistent';
    }
    if (location.field === 'successCriteria') {
      skeleton.successCriteria = ['<structural-success-criterion>'];
    }
  }
  return skeleton;
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
    const args = JSON.parse(originalCall.arguments || '{}');
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
