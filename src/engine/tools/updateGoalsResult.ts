// ---------------------------------------------------------------------------
// Kavi — update_goals tool result
// ---------------------------------------------------------------------------
// What an update_goals call reports back to the model: its argument errors, or the
// mutation it requested together with what that mutation will actually do — whether a
// close is proven, and which goals an activation moves back to pending.
// ---------------------------------------------------------------------------

import { describeUnmetGatingCriteria, isBlockingGoalClosedWithoutProof } from '../goals/goalProof';
import type { AgentGoal, AgentGoalMutation } from '../goals/types';
import type { UpdateGoalsArgumentError } from './toolGoalExecution';

/**
 * What a `complete` request will actually do, reported back to the model.
 *
 * Traced live on an Android emulator. `complete` answered `{"status":"ok"}` whether or
 * not the goal's criteria held, because the result echoed the requested mutation and
 * nothing else; the model could not tell a proven close from an unproven one.
 *
 * Closing is the model's bookkeeping and is never refused: the goal closes either way.
 * What the result must say is whether the close is proven, because only proven blocking
 * goals let the run finish as completed — and, when it is not, which criteria are
 * outstanding and the action that satisfies each: a move, not just a verdict.
 */
function describeCompletionOutcome(
  goalId: string,
  graphGoals: ReadonlyArray<AgentGoal>,
): Record<string, unknown> | null {
  const goal = graphGoals.find((entry) => entry.id === goalId);
  if (!goal) {
    return null;
  }

  const closed: AgentGoal = { ...goal, status: 'completed' };
  if (!isBlockingGoalClosedWithoutProof(closed)) {
    return { closes: true };
  }

  const unmetCriteria = describeUnmetGatingCriteria(closed);
  const hasCriteria = (goal.successCriteria?.length ?? 0) > 0;
  return {
    closes: true,
    proven: false,
    reason: hasCriteria
      ? 'This goal closes, but its success criteria are not met, so the run cannot finish as verified.'
      : 'This goal closes, but it has no success criteria, so nothing proves it and the run cannot finish as verified.',
    ...(unmetCriteria.length > 0 ? { unmetCriteria } : {}),
    // Only recoveries the graph accepts: criteria naming a deliverable cannot be revised,
    // so each unmet criterion's own satisfyBy says whether a correction is legal.
    nextStep:
      (hasCriteria
        ? 'Do what each unmet criterion\'s satisfyBy says'
        : 'Add a specific criterion naming the evidence the work produced with update_goals ' +
          'action "update"') +
      ', or tell the user plainly what could not be confirmed. Repeating this complete call ' +
      'changes nothing.',
  };
}

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
      goals: params.mutation.goals.map((g) => {
        const completion =
          params.mutation.action === 'complete' && g.id && params.graphGoals
            ? describeCompletionOutcome(g.id, params.graphGoals)
            : null;

        return {
          ...(g.id ? { id: g.id } : {}),
          ...(g.title ? { title: g.title } : {}),
          ...(g.status ? { status: g.status } : {}),
          ...(g.completionPolicy ? { completionPolicy: g.completionPolicy } : {}),
          ...(completion ?? {}),
        };
      }),
    },
    null,
    2,
  );
}
