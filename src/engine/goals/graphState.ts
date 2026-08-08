// ---------------------------------------------------------------------------
// Kavi — Goal Graph State Management
// ---------------------------------------------------------------------------
// Applies goal mutations to the graph state. Mutations are triggered by
// graph events (TOOL_RESULT_RECORDED with an update_goals call) or by
// direct event dispatch.
//
// All operations are deterministic and language-agnostic.
// ---------------------------------------------------------------------------

import type { AgentGoal, AgentGoalMutation, AgentGoalStatus } from './types';
import {
  isCountOnlySuccessCriterion,
  isRecognizedSuccessCriterionForm,
} from './completionEvidence';
import {
  createGoal,
  getGoalById,
  isBlockingGoal,
  normalizeGoalCompletionPolicy,
  normalizeGoals,
  resolveGoalCompletionPolicy,
} from './types';
import { formatGoalValidationErrorMessage } from './mutationErrors';
import { backfillGoalEvidenceFromExistingGoals } from './evidenceRouting';
import { validateGoalMutation } from './validation';
import type { GoalMutationValidationContext } from './validation';
import { captureCurrentUserGoalConstraint } from './userConstraints';

function activateGoalInList(
  goals: AgentGoal[],
  goalId: string,
  now: number,
): { goals: AgentGoal[]; errors: string[] } {
  const target = getGoalById(goals, goalId);
  if (!target) {
    return { goals, errors: [] };
  }
  const targetCompletionPolicy = resolveGoalCompletionPolicy(target);
  const targetOwnerLane = target.owner?.trim() || 'supervisor';

  const depsCompleted = target.dependencies.every((depId) => {
    const dep = getGoalById(goals, depId);
    return dep?.status === 'completed';
  });
  if (!depsCompleted) {
    return {
      goals,
      errors: [`[${goalId}] Cannot activate: dependencies are not completed.`],
    };
  }

  // Only the one active goal in a lane receives routed evidence, and activating a goal
  // demotes the previously active one — so running an effectful tool, which materializes
  // a code-owned verification goal, moved the model's own goal to pending exactly when
  // its evidence arrived. The goal could then never complete and the model repeated the
  // side effect trying to re-earn what the run had already proved. A goal still only
  // inherits evidence its own success criteria ask for.
  const inheritedEvidence = backfillGoalEvidenceFromExistingGoals({
    goal: target,
    existingGoals: goals,
  });

  return {
    goals: goals.map((existing) => {
      if (existing.id === goalId) {
        return {
          ...existing,
          status: 'active' as AgentGoalStatus,
          updatedAt: now,
          ...(inheritedEvidence.length
            ? { evidence: Array.from(new Set([...existing.evidence, ...inheritedEvidence])) }
            : {}),
        };
      }
      if (
        existing.status === 'active' &&
        resolveGoalCompletionPolicy(existing) === targetCompletionPolicy &&
        (existing.owner?.trim() || 'supervisor') === targetOwnerLane
      ) {
        return { ...existing, status: 'pending' as AgentGoalStatus, updatedAt: now };
      }
      return existing;
    }),
    errors: [],
  };
}

function removeSuccessCriteria(goal: AgentGoal): AgentGoal {
  const next = { ...goal };
  delete next.successCriteria;
  return next;
}

function normalizeAddGoalPatch(
  patch: AgentGoalMutation['goals'][number],
  options: { defaultCompletionPolicy?: 'blocking' | 'persistent' } = {},
): AgentGoalMutation['goals'][number] {
  const criteria = (patch.successCriteria ?? [])
    .map((criterion) => criterion.trim())
    .filter(Boolean);
  const recognizedCriteria = criteria.filter(isRecognizedSuccessCriterionForm);
  const hasUnrecognizedCriteria = recognizedCriteria.length !== criteria.length;
  const hasSpecificRecognizedCriteria = recognizedCriteria.some(
    (criterion) => !isCountOnlySuccessCriterion(criterion),
  );
  // The engine's own rule is that a blocking goal must carry a specific structural
  // criterion, so when the caller omits the policy the criteria already determine the
  // only legal value — there is nothing to guess. Demanding it be restated made a
  // schema-conformant call fail: `completionPolicy` is absent from the tool schema's
  // `required` list, so a model that follows the schema is rejected at runtime, and the
  // obvious retry ("a goal gets completed, so it is blocking") hits a second wall for
  // missing criteria. Traced live: two rejections plus a third attempt tripped the
  // goal-mutation stall threshold, loop detection killed the run, and the next user turn
  // restarted the same dead end — 95 tool calls across four turns, none of the work done.
  const completionPolicy =
    patch.completionPolicy ??
    options.defaultCompletionPolicy ??
    (hasSpecificRecognizedCriteria ? 'blocking' : 'persistent');

  const shouldStoreAsPersistentFocus =
    completionPolicy === 'persistent' ||
    (patch.status === 'active' &&
      completionPolicy === 'blocking' &&
      hasUnrecognizedCriteria &&
      !hasSpecificRecognizedCriteria);

  if (shouldStoreAsPersistentFocus) {
    const next = { ...patch, completionPolicy: 'persistent' as const };
    delete next.successCriteria;
    return next;
  }

  return { ...patch, completionPolicy };
}

function everyMutationGoal(
  goals: ReadonlyArray<AgentGoalMutation['goals'][number]>,
  predicate: (patch: AgentGoalMutation['goals'][number]) => boolean,
): boolean {
  return goals.length > 0 && goals.every(predicate);
}

function isActivationOnlyUpdate(
  patch: AgentGoalMutation['goals'][number],
  currentGoals: ReadonlyArray<AgentGoal>,
): boolean {
  if (patch.status !== 'active') return false;
  const existing = patch.id?.trim() ? getGoalById(currentGoals, patch.id.trim()) : null;
  const changesTitle = Boolean(
    patch.title?.trim() && existing && patch.title.trim() !== existing.title,
  );
  return (
    !changesTitle &&
    patch.description === undefined &&
    patch.dependencies === undefined &&
    patch.evidence === undefined &&
    patch.requiredCapabilities === undefined &&
    patch.requiredResourceKinds === undefined &&
    patch.owner === undefined &&
    patch.successCriteria === undefined &&
    patch.retainCurrentUserConstraint === undefined &&
    patch.completionPolicy === undefined &&
    patch.blockedReason === undefined
  );
}

export function normalizeGoalMutationForApplication(
  currentGoals: ReadonlyArray<AgentGoal>,
  inputMutation: AgentGoalMutation,
): AgentGoalMutation {
  const mutation = inputMutation;
  if (mutation.goals.length === 0) {
    return mutation;
  }

  if (mutation.action === 'add') {
    const goals = mutation.goals.map((patch) => normalizeAddGoalPatch(patch));
    const allExisting = everyMutationGoal(goals, (patch) =>
      Boolean(patch.id?.trim() && getGoalById(currentGoals, patch.id.trim())),
    );
    if (!allExisting) {
      return { ...mutation, goals };
    }

    const wantsActivation = goals.some((patch) => patch.status === 'active');
    return {
      action: wantsActivation ? 'activate' : 'update',
      goals,
    };
  }

  if (
    mutation.action === 'activate' &&
    everyMutationGoal(mutation.goals, (patch) =>
      Boolean(
        patch.id?.trim() && patch.title?.trim() && !getGoalById(currentGoals, patch.id.trim()),
      ),
    )
  ) {
    return {
      action: 'add',
      goals: mutation.goals.map((patch) =>
        normalizeAddGoalPatch(
          {
            ...patch,
            status: 'active',
            completionPolicy: patch.completionPolicy ?? 'persistent',
          },
          { defaultCompletionPolicy: 'persistent' },
        ),
      ),
    };
  }

  if (
    mutation.action === 'complete' &&
    everyMutationGoal(mutation.goals, (patch) => {
      const goalId = patch.id?.trim();
      const existing = goalId ? getGoalById(currentGoals, goalId) : null;
      return Boolean(existing && resolveGoalCompletionPolicy(existing) === 'persistent');
    })
  ) {
    return {
      action: 'update',
      goals: mutation.goals.map((patch) => {
        const next = { ...patch };
        delete next.status;
        delete next.successCriteria;
        return next;
      }),
    };
  }

  if (
    mutation.action === 'update' &&
    everyMutationGoal(mutation.goals, (patch) => isActivationOnlyUpdate(patch, currentGoals))
  ) {
    return {
      action: 'activate',
      goals: mutation.goals,
    };
  }

  return mutation;
}

export interface GoalStateSnapshot {
  goals: AgentGoal[];
  updatedAt: number;
}

export type GoalGraphEvent =
  | {
      type: 'GOALS_UPDATED';
      goals: AgentGoal[];
      reason?: string;
      timestamp?: number;
    }
  | {
      type: 'GOAL_EVIDENCE_ADDED';
      goalId: string;
      evidence: string;
      timestamp?: number;
    };

export function applyGoalMutation(
  currentGoals: ReadonlyArray<AgentGoal>,
  mutation: AgentGoalMutation,
  now: number = Date.now(),
  context: GoalMutationValidationContext = {},
): { goals: AgentGoal[]; errors: string[] } {
  const normalizedMutation = retainInitialBlockingGoalConstraint(
    currentGoals,
    normalizeGoalMutationForApplication(currentGoals, mutation),
    context,
  );
  const validation = validateGoalMutation(normalizedMutation, currentGoals, context);
  if (!validation.valid) {
    return {
      goals: currentGoals.map((g) => ({ ...g })),
      errors: validation.errors.map(formatGoalValidationErrorMessage),
    };
  }

  let goals = currentGoals.map((g) => ({ ...g }));

  switch (normalizedMutation.action) {
    case 'add': {
      const activateGoalIds: string[] = [];
      for (const g of normalizedMutation.goals) {
        if (!g.title?.trim()) continue;
        const requestedStatus = g.status ?? 'pending';
        const goal = createGoal({
          id: g.id,
          title: g.title,
          description: g.description,
          status: requestedStatus === 'active' ? 'pending' : requestedStatus,
          dependencies: g.dependencies,
          evidence: g.evidence,
          owner: g.owner,
          requiredCapabilities: g.requiredCapabilities,
          requiredResourceKinds: g.requiredResourceKinds,
          successCriteria: g.successCriteria,
          userConstraints: capturedUserConstraint(g, context),
          completionPolicy: normalizeGoalCompletionPolicy(g.completionPolicy),
          blockedReason: g.blockedReason,
          now,
        });
        goals.push(goal);
        if (requestedStatus === 'active') {
          activateGoalIds.push(goal.id);
        }
      }

      for (const goalId of activateGoalIds) {
        const activated = activateGoalInList(goals, goalId, now);
        if (activated.errors.length > 0) {
          return {
            goals: currentGoals.map((goal) => ({ ...goal })),
            errors: activated.errors,
          };
        }
        goals = activated.goals;
      }
      break;
    }

    case 'complete': {
      for (const g of normalizedMutation.goals) {
        if (!g.id?.trim()) continue;
        goals = goals.map((existing) => {
          if (existing.id !== g.id) return existing;
          const evidence = g.evidence?.length
            ? Array.from(new Set([...existing.evidence, ...g.evidence]))
            : existing.evidence;
          return {
            ...existing,
            status: 'completed' as AgentGoalStatus,
            evidence,
            updatedAt: now,
            // Completing an already-completed goal must not move its completion time:
            // the engine auto-completes a goal as soon as its criteria are satisfied, so
            // a model that then says "complete" is re-running a terminal transition.
            completedAt: existing.completedAt ?? now,
            blockedReason: undefined,
            ...((existing.userConstraints?.length ?? 0) > 0
              ? { userConstraintDeliveryPending: true as const }
              : {}),
          };
        });
      }
      break;
    }

    case 'activate': {
      for (const g of normalizedMutation.goals) {
        if (!g.id?.trim()) continue;
        const activated = activateGoalInList(goals, g.id.trim(), now);
        if (activated.errors.length > 0) {
          return {
            goals: currentGoals.map((goal) => ({ ...goal })),
            errors: activated.errors,
          };
        }
        goals = activated.goals;
      }
      break;
    }

    case 'block': {
      for (const g of normalizedMutation.goals) {
        if (!g.id?.trim()) continue;
        goals = goals.map((existing) =>
          existing.id === g.id
            ? {
                ...existing,
                status: 'blocked' as AgentGoalStatus,
                ...(g.blockedReason?.trim() ? { blockedReason: g.blockedReason.trim() } : {}),
                // Validation already admitted this block, which for a blocking goal
                // means the exhaustion gate accepted it. Stamp that here, in code, so
                // an earned abandonment stays distinguishable from a code-driven block.
                ...(isBlockingGoal(existing) ? { abandonedAfterExhaustionAt: now } : {}),
                updatedAt: now,
              }
            : existing,
        );
      }
      break;
    }

    case 'remove': {
      const idsToRemove = new Set(
        normalizedMutation.goals.map((g) => g.id?.trim()).filter((id): id is string => !!id),
      );
      // Also remove goals that depend on removed goals
      const cascadingIds = new Set(idsToRemove);
      let changed = true;
      while (changed) {
        changed = false;
        for (const g of goals) {
          if (!cascadingIds.has(g.id) && g.dependencies.some((d) => cascadingIds.has(d))) {
            cascadingIds.add(g.id);
            changed = true;
          }
        }
      }
      goals = goals.filter((g) => !cascadingIds.has(g.id));
      break;
    }

    case 'update': {
      const activateGoalIds: string[] = [];
      for (const g of normalizedMutation.goals) {
        if (!g.id?.trim()) continue;
        goals = goals.map((existing) => {
          if (existing.id !== g.id) return existing;
          const updates: Partial<AgentGoal> = { updatedAt: now };
          const nextCompletionPolicy = g.completionPolicy ?? resolveGoalCompletionPolicy(existing);
          if (g.title?.trim()) updates.title = g.title.trim();
          if (g.description !== undefined) updates.description = g.description.trim() || undefined;
          if (g.status === 'active') {
            updates.status = 'pending';
            activateGoalIds.push(existing.id);
          } else if (g.status) {
            updates.status = g.status;
          }
          if (g.dependencies) updates.dependencies = Array.from(new Set(g.dependencies));
          if (g.evidence?.length) {
            updates.evidence = Array.from(new Set([...existing.evidence, ...g.evidence]));
          }
          if (g.requiredCapabilities) updates.requiredCapabilities = g.requiredCapabilities;
          if (g.requiredResourceKinds) updates.requiredResourceKinds = g.requiredResourceKinds;
          if (g.owner) updates.owner = g.owner;
          if (g.successCriteria && nextCompletionPolicy === 'blocking') {
            updates.successCriteria = g.successCriteria;
          }
          const appendedUserConstraints = capturedUserConstraint(g, context);
          if (appendedUserConstraints?.length) {
            updates.userConstraints = [
              ...(existing.userConstraints ?? []),
              ...appendedUserConstraints,
            ];
          }
          if (g.completionPolicy) updates.completionPolicy = g.completionPolicy;
          if (g.blockedReason !== undefined) {
            updates.blockedReason = g.blockedReason.trim() || undefined;
          }
          const nextGoal = { ...existing, ...updates };
          return nextCompletionPolicy === 'persistent' ? removeSuccessCriteria(nextGoal) : nextGoal;
        });
      }
      for (const goalId of activateGoalIds) {
        const activated = activateGoalInList(goals, goalId, now);
        if (activated.errors.length > 0) {
          return {
            goals: currentGoals.map((goal) => ({ ...goal })),
            errors: activated.errors,
          };
        }
        goals = activated.goals;
      }
      break;
    }
  }

  return { goals: reconcileGoalEvidence(goals), errors: [] };
}

function retainInitialBlockingGoalConstraint(
  currentGoals: ReadonlyArray<AgentGoal>,
  mutation: AgentGoalMutation,
  context: GoalMutationValidationContext,
): AgentGoalMutation {
  if (
    mutation.action !== 'add' ||
    mutation.goals.some((goal) => goal.retainCurrentUserConstraint === true) ||
    currentGoals.some(
      (goal) =>
        (goal.userConstraints?.length ?? 0) > 0 || goal.userConstraintIntegrity === 'conflict',
    )
  ) {
    return mutation;
  }

  const captured = captureCurrentUserGoalConstraint({
    currentUserMessage: context.currentUserMessage,
  });
  if (!captured.captured) {
    return mutation;
  }

  const activeBlockingIndex = mutation.goals.findIndex(
    (goal) => goal.completionPolicy === 'blocking' && goal.status === 'active',
  );
  const blockingIndex =
    activeBlockingIndex >= 0
      ? activeBlockingIndex
      : mutation.goals.findIndex((goal) => goal.completionPolicy === 'blocking');
  if (blockingIndex < 0) {
    return mutation;
  }

  return {
    ...mutation,
    goals: mutation.goals.map((goal, index) =>
      index === blockingIndex ? { ...goal, retainCurrentUserConstraint: true } : goal,
    ),
  };
}

function capturedUserConstraint(
  patch: AgentGoalMutation['goals'][number],
  context: GoalMutationValidationContext,
): AgentGoal['userConstraints'] {
  if (patch.retainCurrentUserConstraint !== true) return undefined;
  const captured = captureCurrentUserGoalConstraint({
    currentUserMessage: context.currentUserMessage,
  });
  return captured.captured ? [captured.constraint] : undefined;
}

export function addGoalEvidence(
  goals: ReadonlyArray<AgentGoal>,
  goalId: string,
  evidence: string,
  now: number = Date.now(),
): AgentGoal[] {
  return goals.map((g) =>
    g.id === goalId
      ? {
          ...g,
          evidence: Array.from(new Set([...g.evidence, evidence])),
          updatedAt: now,
        }
      : g,
  );
}


/**
 * Gives every goal the evidence its own criteria name, wherever in the run it landed.
 *
 * Evidence is routed once, when a tool result arrives. A workspace write, though, is not
 * provable at that instant: `evidence.artifact` requires a receipt whose
 * `verificationState` is `verified`, and verification is exactly what the code-owned
 * `effect-*` goal is materialized to establish. The receipt therefore settles onto that
 * verification goal after routing has already run, and the model's own goal — which named
 * the very same path — is left holding nothing.
 *
 * Traced on-device. `moon-facts` declared `evidence.artifact:artifacts/moon-facts.md`,
 * `write_file` wrote exactly that path, and the goal still showed `evidence: 0`.
 * Completing it was refused for unmet criteria the run had in fact satisfied, and only
 * `activate` repaired it, because activation was the one place that replayed evidence
 * between goals. Every occurrence of the redundant `complete`-then-`activate` pair came
 * from this.
 *
 * Reconciling after each mutation makes that replay unconditional instead of a side
 * effect of one lifecycle transition. It reuses the activation predicate exactly, so a
 * goal still receives only evidence it explicitly asserts it needs, never evidence it
 * merely sits beside — and it is idempotent, so repeating it changes nothing.
 */
function reconcileGoalEvidence(goals: AgentGoal[]): AgentGoal[] {
  let changed = false;
  const reconciled = goals.map((goal) => {
    const inherited = backfillGoalEvidenceFromExistingGoals({ goal, existingGoals: goals });
    if (inherited.length === 0) {
      return goal;
    }
    changed = true;
    return { ...goal, evidence: Array.from(new Set([...goal.evidence, ...inherited])) };
  });
  return changed ? reconciled : goals;
}

export function computeGoalStateFromSnapshot(
  snapshot: GoalStateSnapshot | undefined,
): GoalStateSnapshot {
  const goals = normalizeGoals(snapshot?.goals);
  return { goals, updatedAt: snapshot?.updatedAt ?? Date.now() };
}

export function buildInitialGoalState(): GoalStateSnapshot {
  return { goals: [], updatedAt: Date.now() };
}
