import type { AgentGoal, AgentGoalMutation } from './types';
import { resolveGoalCompletionPolicy } from './types';
import {
  captureCurrentUserGoalConstraint,
  MAX_AGENT_GOAL_USER_CONSTRAINTS,
} from './userConstraints';

export interface GoalMutationValidationContext {
  currentUserMessage?: Readonly<{ id: string; text: string }>;
}

export type GoalUserConstraintValidationError = Readonly<{
  goalId?: string;
  code:
    | 'duplicate_user_constraints'
    | 'invalid_user_constraints'
    | 'ungrounded_user_constraints'
    | 'unsupported_user_constraints';
  message: string;
}>;

function cascadingRemovalGoals(
  mutation: AgentGoalMutation,
  existingGoals: ReadonlyArray<AgentGoal>,
): AgentGoal[] {
  const removedIds = new Set(
    mutation.goals.map((goal) => goal.id?.trim()).filter((id): id is string => Boolean(id)),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const goal of existingGoals) {
      if (!removedIds.has(goal.id) && goal.dependencies.some((id) => removedIds.has(id))) {
        removedIds.add(goal.id);
        changed = true;
      }
    }
  }
  return existingGoals.filter((goal) => removedIds.has(goal.id));
}

export function validateGoalConstraintRemoval(
  mutation: AgentGoalMutation,
  existingGoals: ReadonlyArray<AgentGoal>,
): GoalUserConstraintValidationError[] {
  if (mutation.action !== 'remove') return [];
  return cascadingRemovalGoals(mutation, existingGoals)
    .filter(
      (goal) =>
        ((goal.status !== 'completed' || goal.userConstraintDeliveryPending === true) &&
          (goal.userConstraints?.length ?? 0) > 0) ||
        goal.userConstraintIntegrity === 'conflict',
    )
    .map((goal) => ({
      goalId: goal.id,
      code: 'unsupported_user_constraints' as const,
      message:
        'Cannot remove a goal subtree with stored user constraints; cancel the run to abandon constrained work.',
    }));
}

function resolvePatchCompletionPolicy(
  patch: AgentGoalMutation['goals'][number],
  existing: AgentGoal | undefined,
): AgentGoal['completionPolicy'] | undefined {
  if (patch.completionPolicy === 'blocking' || patch.completionPolicy === 'persistent') {
    return patch.completionPolicy;
  }
  return existing ? resolveGoalCompletionPolicy(existing) : undefined;
}

function retainedRunConstraintCount(goals: ReadonlyArray<AgentGoal>): number {
  return goals
    .filter(
      (goal) =>
        goal.status === 'active' ||
        goal.status === 'blocked' ||
        goal.status === 'pending' ||
        goal.userConstraintDeliveryPending === true,
    )
    .reduce((count, goal) => count + (goal.userConstraints?.length ?? 0), 0);
}

export function validateGoalConstraintMutationCapacity(
  mutation: AgentGoalMutation,
  existingGoals: ReadonlyArray<AgentGoal>,
): GoalUserConstraintValidationError[] {
  const retainedGoalIds = mutation.goals
    .filter((goal) => goal.retainCurrentUserConstraint === true)
    .map((goal) => goal.id?.trim() || '');
  const duplicateGoalId = retainedGoalIds.find(
    (goalId, index) => goalId && retainedGoalIds.indexOf(goalId) !== index,
  );
  if (duplicateGoalId) {
    return [
      {
        goalId: duplicateGoalId,
        code: 'duplicate_user_constraints',
        message: 'A mutation can retain the current user statement only once per goal.',
      },
    ];
  }
  if (
    retainedRunConstraintCount(existingGoals) + retainedGoalIds.length >
    MAX_AGENT_GOAL_USER_CONSTRAINTS
  ) {
    return [
      {
        code: 'invalid_user_constraints',
        message: `A run can retain at most ${MAX_AGENT_GOAL_USER_CONSTRAINTS} current or delivery-pending user constraint statements.`,
      },
    ];
  }
  return [];
}

export function validateGoalUserConstraints(params: {
  action: AgentGoalMutation['action'];
  patch: AgentGoalMutation['goals'][number];
  existingGoals: ReadonlyArray<AgentGoal>;
  context: GoalMutationValidationContext;
}): GoalUserConstraintValidationError[] {
  const errors: GoalUserConstraintValidationError[] = [];
  const goalId = params.patch.id?.trim();
  const existing = goalId ? params.existingGoals.find((goal) => goal.id === goalId) : undefined;
  if (existing?.userConstraintIntegrity === 'conflict') {
    return [
      {
        goalId,
        code: 'unsupported_user_constraints',
        message: 'Stored user constraint state is conflicted and cannot be mutated.',
      },
    ];
  }
  if (
    params.action === 'update' &&
    params.patch.completionPolicy === 'persistent' &&
    (existing?.userConstraints?.length ?? 0) > 0
  ) {
    errors.push({
      goalId,
      code: 'unsupported_user_constraints',
      message: 'A constrained blocking goal cannot be converted to persistent or cleared.',
    });
  }

  if (params.patch.retainCurrentUserConstraint !== true) return errors;
  if (params.action !== 'add' && params.action !== 'update') {
    errors.push({
      goalId,
      code: 'unsupported_user_constraints',
      message: 'User constraints are supported only for add or update actions.',
    });
    return errors;
  }
  const completionPolicy = resolvePatchCompletionPolicy(params.patch, existing);
  if (
    completionPolicy !== 'blocking' ||
    existing?.status === 'completed' ||
    params.patch.status === 'completed'
  ) {
    errors.push({
      goalId,
      code: 'unsupported_user_constraints',
      message: 'User constraints can be attached only to incomplete blocking goals.',
    });
    return errors;
  }
  const captured = captureCurrentUserGoalConstraint({
    currentUserMessage: params.context.currentUserMessage,
  });
  if (!captured.captured) {
    errors.push({
      goalId,
      code: 'ungrounded_user_constraints',
      message: `Unable to retain the entire code-owned current user message (${captured.code}${captured.textCode ? `:${captured.textCode}` : ''}).`,
    });
    return errors;
  }
  const conflictingSource = params.existingGoals.some((goal) =>
    (goal.userConstraints ?? []).some(
      (constraint) =>
        constraint.sourceMessageId === captured.constraint.sourceMessageId &&
        constraint.text !== captured.constraint.text,
    ),
  );
  if (conflictingSource) {
    errors.push({
      goalId,
      code: 'ungrounded_user_constraints',
      message: 'The code-owned source message ID already maps to different retained text.',
    });
    return errors;
  }
  const existingTexts = new Set((existing?.userConstraints ?? []).map((entry) => entry.text));
  if (existingTexts.has(captured.constraint.text)) {
    errors.push({
      goalId,
      code: 'duplicate_user_constraints',
      message: 'The current user statement duplicates an existing retained constraint.',
    });
    return errors;
  }
  return errors;
}
