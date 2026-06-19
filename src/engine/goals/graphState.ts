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
  normalizeGoalCompletionPolicy,
  normalizeGoals,
  resolveGoalCompletionPolicy,
} from './types';
import { formatGoalValidationErrorMessage } from './mutationErrors';
import { validateGoalMutation } from './validation';

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

  return {
    goals: goals.map((existing) => {
      if (existing.id === goalId) {
        return { ...existing, status: 'active' as AgentGoalStatus, updatedAt: now };
      }
      if (
        existing.status === 'active' &&
        resolveGoalCompletionPolicy(existing) === targetCompletionPolicy
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
  const completionPolicy = patch.completionPolicy ?? options.defaultCompletionPolicy;
  if (!completionPolicy) {
    return patch;
  }

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

export function normalizeGoalMutationForApplication(
  currentGoals: ReadonlyArray<AgentGoal>,
  mutation: AgentGoalMutation,
): AgentGoalMutation {
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
      Boolean(patch.id?.trim() && patch.title?.trim() && !getGoalById(currentGoals, patch.id.trim())),
    )
  ) {
    return {
      action: 'add',
      goals: mutation.goals.map((patch) =>
        normalizeAddGoalPatch({
          ...patch,
          status: 'active',
          completionPolicy: patch.completionPolicy ?? 'persistent',
        }, { defaultCompletionPolicy: 'persistent' }),
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
    everyMutationGoal(mutation.goals, (patch) => patch.status === 'active')
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
): { goals: AgentGoal[]; errors: string[] } {
  const normalizedMutation = normalizeGoalMutationForApplication(currentGoals, mutation);
  const validation = validateGoalMutation(normalizedMutation, currentGoals);
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
            completedAt: now,
            blockedReason: undefined,
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
      for (const g of normalizedMutation.goals) {
        if (!g.id?.trim()) continue;
        goals = goals.map((existing) => {
          if (existing.id !== g.id) return existing;
          const updates: Partial<AgentGoal> = { updatedAt: now };
          const nextCompletionPolicy = g.completionPolicy ?? resolveGoalCompletionPolicy(existing);
          if (g.title?.trim()) updates.title = g.title.trim();
          if (g.description !== undefined) updates.description = g.description.trim() || undefined;
          if (g.status) updates.status = g.status;
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
          if (g.completionPolicy) updates.completionPolicy = g.completionPolicy;
          if (g.blockedReason !== undefined) {
            updates.blockedReason = g.blockedReason.trim() || undefined;
          }
          const nextGoal = { ...existing, ...updates };
          return nextCompletionPolicy === 'persistent' ? removeSuccessCriteria(nextGoal) : nextGoal;
        });
      }
      break;
    }
  }

  return { goals, errors: [] };
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

export function computeGoalStateFromSnapshot(
  snapshot: GoalStateSnapshot | undefined,
): GoalStateSnapshot {
  const goals = normalizeGoals(snapshot?.goals);
  return { goals, updatedAt: snapshot?.updatedAt ?? Date.now() };
}

export function buildInitialGoalState(): GoalStateSnapshot {
  return { goals: [], updatedAt: Date.now() };
}
