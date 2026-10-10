// ---------------------------------------------------------------------------
// Kavi — update_goals tool result
// ---------------------------------------------------------------------------
// What an update_goals call reports back to the model: its argument errors, or the
// mutation it requested, and which goals an activation moves back to pending.
// ---------------------------------------------------------------------------

import type { AgentGoal, AgentGoalMutation } from '../goals/types';
import type { UpdateGoalsArgumentError } from './toolGoalExecution';


/**
 * The goals this mutation moves back to pending, when it activates something.
 *
 * Exactly one goal is active per owner lane, so activating a goal demotes whichever goal
 * was active there. Nothing said so, and the silence was expensive.
 *
 * Traced live on an Android emulator. The model declared a four-step plan with every step
 * `status: "active"`, which leaves only the last one active:
 *
 *   add [g1, g2, g3] all active  ->  g1=pending g2=pending g3=active
 *   activate g1                  ->  g1=active  g2=pending g3=pending
 *
 * It then spent twelve update_goals calls on four goals, re-activating each step as it
 * reached it and demoting another every time. Reporting the demotion turns a silent rule
 * into an observable one, so the plan can be written the way the graph actually works.
 */
function describeGoalsDemotedByActivation(params: {
  mutation: AgentGoalMutation;
  graphGoals?: ReadonlyArray<AgentGoal>;
}): Record<string, unknown> | null {
  const graphGoals = params.graphGoals;
  if (!graphGoals?.length) {
    return null;
  }

  const activatedIds = params.mutation.goals
    .filter(
      (goal) =>
        params.mutation.action === 'activate' ||
        (goal.status === 'active' &&
          (params.mutation.action === 'add' || params.mutation.action === 'update')),
    )
    .map((goal) => goal.id?.trim())
    .filter((id): id is string => Boolean(id));

  if (activatedIds.length === 0) {
    return null;
  }

  const lanesActivated = new Set(
    activatedIds.map(
      (id) => graphGoals.find((goal) => goal.id === id)?.owner?.trim() || 'supervisor',
    ),
  );
  const demotedIds = graphGoals
    .filter(
      (goal) =>
        goal.status === 'active' &&
        !activatedIds.includes(goal.id) &&
        lanesActivated.has(goal.owner?.trim() || 'supervisor'),
    )
    .map((goal) => goal.id);

  const extraActivations = activatedIds.length > 1 ? activatedIds.slice(0, -1) : [];
  if (demotedIds.length === 0 && extraActivations.length === 0) {
    return null;
  }

  return {
    ...(demotedIds.length > 0 ? { movedToPending: demotedIds } : {}),
    ...(extraActivations.length > 0 ? { notActivated: extraActivations } : {}),
    reason:
      'One goal is active at a time per owner. Activating a goal moves the previously ' +
      'active one back to pending, and marking several goals active in one call leaves ' +
      'only the last of them active.',
    nextStep:
      'Keep later steps pending and advance the plan by completing the active goal and ' +
      'activating the next in the same call.',
  };
}

export function buildUpdateGoalsResult(params: {
  mutation: AgentGoalMutation;
  validationErrors: ReadonlyArray<UpdateGoalsArgumentError>;
  graphGoals?: ReadonlyArray<AgentGoal>;
}): string {
  if (params.validationErrors.length > 0) {
    return JSON.stringify(
      {
        status: 'error',
        action: params.mutation.action,
        errors: params.validationErrors.map((error) => error.message),
        structuredErrors: params.validationErrors,
      },
      null,
      2,
    );
  }

  const demoted = describeGoalsDemotedByActivation({
    mutation: params.mutation,
    graphGoals: params.graphGoals,
  });

  return JSON.stringify(
    {
      status: 'ok',
      action: params.mutation.action,
      ...(demoted ? { activationSideEffect: demoted } : {}),
      goals: params.mutation.goals.map((g) => ({
        ...(g.id ? { id: g.id } : {}),
        ...(g.title ? { title: g.title } : {}),
        ...(g.status ? { status: g.status } : {}),
        ...(g.completionPolicy ? { completionPolicy: g.completionPolicy } : {}),
      })),
    },
    null,
    2,
  );
}
