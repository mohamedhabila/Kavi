// ---------------------------------------------------------------------------
// Kavi — Goal Mutation Validation
// ---------------------------------------------------------------------------
// Structural validation for goal mutations. No English heuristics.
// Pure graph logic: cycle detection, duplicate ID prevention, referential
// integrity.
// ---------------------------------------------------------------------------

import { GOAL_BOOTSTRAP_TOOL_NAME } from './bootstrap';
import {
  evaluateGoalEvidenceGaps,
  isCountOnlySuccessCriterion,
  isRecognizedSuccessCriterionForm,
  isSuccessCriterionMet,
} from './completionEvidence';
import type { AgentGoal, AgentGoalMutation, AgentGoalStatus } from './types';
import { createGoal, isBlockingGoal } from './types';
import { isRegisteredToolName } from '../tools/toolNameNormalization';

const INTERNAL_DELIVERABLE_TOOL_NAMES = new Set([
  GOAL_BOOTSTRAP_TOOL_NAME,
  'tool_catalog',
  'tool_describe',
]);
const REGISTERED_NON_TOOL_EVIDENCE_PREFIXES = new Set(['worker']);

export type GoalValidationErrorCode =
  | 'missing_title'
  | 'missing_completion_policy'
  | 'missing_success_criteria'
  | 'weak_success_criteria'
  | 'invalid_success_criteria'
  | 'goal_not_found'
  | 'duplicate_id'
  | 'dependency_missing'
  | 'cycle_detected'
  | 'invalid_lifecycle'
  | 'evidence_required'
  | 'evidence_satisfied'
  | 'invalid_block'
  | 'invalid_update_action'
  | 'invalid_add_status';

export interface GoalValidationError {
  goalId?: string;
  code: GoalValidationErrorCode;
  message: string;
}

export interface GoalValidationResult {
  valid: boolean;
  errors: GoalValidationError[];
}

function goalMeetsCompletionRequirements(
  goal: Pick<AgentGoal, 'evidence' | 'successCriteria'>,
  extraEvidence: ReadonlyArray<string> = [],
): boolean {
  const evidence = extraEvidence.length
    ? Array.from(new Set([...goal.evidence, ...extraEvidence]))
    : goal.evidence;
  const criteria = goal.successCriteria ?? [];
  if (criteria.length === 0) {
    return evidence.length > 0;
  }

  const hypotheticalGoal = createGoal({
    id: 'validation',
    title: 'validation',
    status: 'completed',
    evidence,
    successCriteria: criteria,
  });
  return criteria.every((criterion) => isSuccessCriterionMet(hypotheticalGoal, criterion));
}

function goalPatchMeetsTerminalCompletionRequirements(
  patch: AgentGoalMutation['goals'][number],
): boolean {
  return goalMeetsCompletionRequirements(
    {
      evidence: patch.evidence ?? [],
      successCriteria: patch.successCriteria,
    },
    [],
  );
}

function hasExplicitCompletionPolicy(patch: AgentGoalMutation['goals'][number]): boolean {
  return patch.completionPolicy === 'blocking' || patch.completionPolicy === 'persistent';
}

function resolvePatchCompletionPolicy(
  patch: AgentGoalMutation['goals'][number],
  existingGoals: ReadonlyArray<AgentGoal>,
): AgentGoal['completionPolicy'] | undefined {
  if (patch.completionPolicy === 'blocking' || patch.completionPolicy === 'persistent') {
    return patch.completionPolicy;
  }
  const goalId = patch.id?.trim();
  if (!goalId) {
    return undefined;
  }
  return existingGoals.find((goal) => goal.id === goalId)?.completionPolicy;
}

function shouldValidateSuccessCriteria(
  patch: AgentGoalMutation['goals'][number],
  existingGoals: ReadonlyArray<AgentGoal>,
): boolean {
  return resolvePatchCompletionPolicy(patch, existingGoals) !== 'persistent';
}

function hasStructuralSuccessCriteria(patch: AgentGoalMutation['goals'][number]): boolean {
  return (patch.successCriteria ?? []).some((criterion) =>
    isRecognizedSuccessCriterionForm(criterion),
  );
}

function hasSpecificSuccessCriteria(patch: AgentGoalMutation['goals'][number]): boolean {
  return (patch.successCriteria ?? []).some(
    (criterion) =>
      isRecognizedSuccessCriterionForm(criterion) && !isCountOnlySuccessCriterion(criterion),
  );
}

function findInvalidSuccessCriteria(
  patch: AgentGoalMutation['goals'][number],
): ReadonlyArray<string> {
  return (patch.successCriteria ?? [])
    .map((criterion) => criterion.trim())
    .filter((criterion) => criterion.length > 0 && !isRecognizedSuccessCriterionForm(criterion));
}

function findInternalGraphEvidenceCriteria(
  patch: AgentGoalMutation['goals'][number],
): ReadonlyArray<string> {
  return (patch.successCriteria ?? [])
    .map((criterion) => criterion.trim())
    .filter((criterion) => referencesInternalGraphToolCriterion(criterion));
}

function findUnknownToolEvidenceCriteria(
  patch: AgentGoalMutation['goals'][number],
): ReadonlyArray<string> {
  return (patch.successCriteria ?? [])
    .map((criterion) => criterion.trim())
    .filter((criterion) => {
      const toolToken = readEvidenceToolCriterionToken(criterion);
      return Boolean(toolToken && !isRegisteredToolName(toolToken));
    });
}

function findUnknownEvidencePrefixCriteria(
  patch: AgentGoalMutation['goals'][number],
): ReadonlyArray<string> {
  return (patch.successCriteria ?? [])
    .map((criterion) => criterion.trim())
    .filter((criterion) => {
      const prefixToken = readEvidencePrefixCriterionToken(criterion);
      return Boolean(
        prefixToken &&
          !REGISTERED_NON_TOOL_EVIDENCE_PREFIXES.has(prefixToken) &&
          !isRegisteredToolName(prefixToken),
      );
    });
}

function readEvidenceToolCriterionToken(criterion: string): string | null {
  const prefix = 'evidence.tool:';
  if (!criterion.startsWith(prefix)) {
    return null;
  }
  const toolToken = criterion.slice(prefix.length).trim();
  return toolToken.length > 0 ? toolToken : null;
}

function readEvidencePrefixCriterionToken(criterion: string): string | null {
  const prefix = 'evidence.prefix:';
  if (!criterion.startsWith(prefix)) {
    return null;
  }
  const prefixToken = criterion.slice(prefix.length).trim();
  return prefixToken.length > 0 ? prefixToken : null;
}

function referencesInternalGraphToolCriterion(criterion: string): boolean {
  for (const prefix of ['evidence.tool:', 'evidence.prefix:'] as const) {
    if (!criterion.startsWith(prefix)) {
      continue;
    }

    const toolToken = criterion.slice(prefix.length).trim();
    if (!toolToken) {
      continue;
    }

    const segments = toolToken
      .split(':')
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (segments.some((segment) => INTERNAL_DELIVERABLE_TOOL_NAMES.has(segment))) {
      return true;
    }
  }

  return false;
}

function validateGoalBlockTransition(
  goalId: string | undefined,
  existingGoals: ReadonlyArray<AgentGoal>,
  errors: GoalValidationError[],
): void {
  const normalizedId = goalId?.trim();
  if (!normalizedId) {
    return;
  }

  const existing = existingGoals.find((goal) => goal.id === normalizedId);
  if (!existing) {
    return;
  }

  if (existing.status === 'pending') {
    errors.push({
      goalId: normalizedId,
      code: 'invalid_block',
      message: 'Cannot block a pending goal. Use activate or remove instead.',
    });
    return;
  }

  if (isBlockingGoal(existing)) {
    const evidenceSatisfied =
      existing.status === 'active' &&
      (existing.successCriteria?.length ?? 0) > 0 &&
      evaluateGoalEvidenceGaps([existing]).length === 0;
    errors.push({
      goalId: normalizedId,
      code: evidenceSatisfied ? 'evidence_satisfied' : 'evidence_required',
      message: evidenceSatisfied
        ? 'Cannot block a goal whose structural evidence requirements are already satisfied.'
        : 'Cannot block a blocking goal before structural evidence requirements are met. Continue execution or let the graph terminal blocker handle unrecoverable conditions.',
    });
    return;
  }

  errors.push({
    goalId: normalizedId,
    code: 'invalid_block',
    message:
      'Cannot block a persistent goal through update_goals. Persistent goals are ongoing context; remove them when they no longer apply.',
  });
}

function validateGoalLifecycleTransition(
  action: AgentGoalMutation['action'],
  goalId: string | undefined,
  nextStatus: AgentGoalStatus | undefined,
  patchEvidence: ReadonlyArray<string> | undefined,
  existingGoals: ReadonlyArray<AgentGoal>,
  errors: GoalValidationError[],
): void {
  const normalizedId = goalId?.trim();
  if (!normalizedId) {
    return;
  }

  const existing = existingGoals.find((goal) => goal.id === normalizedId);
  if (!existing) {
    return;
  }

  if (action === 'complete' || (action === 'update' && nextStatus === 'completed')) {
    const extraEvidence = action === 'complete' ? (patchEvidence ?? []) : [];

    if (existing.status === 'blocked') {
      if (!goalMeetsCompletionRequirements(existing, extraEvidence)) {
        errors.push({
          goalId: normalizedId,
          code: 'evidence_required',
          message: 'Cannot complete a goal before structural evidence requirements are met.',
        });
      }
      return;
    }

    if (existing.status !== 'active') {
      errors.push({
        goalId: normalizedId,
        code: 'invalid_lifecycle',
        message: 'Cannot complete a goal that is not active. Use activate first.',
      });
      return;
    }

    if (!isBlockingGoal(existing)) {
      errors.push({
        goalId: normalizedId,
        code: 'invalid_lifecycle',
        message:
          'Cannot complete a persistent goal. Persistent goals are ongoing context; remove them or convert them to blocking deliverables with structural success criteria before completion.',
      });
      return;
    }

    if (!goalMeetsCompletionRequirements(existing, extraEvidence)) {
      errors.push({
        goalId: normalizedId,
        code: 'evidence_required',
        message: 'Cannot complete a goal before structural evidence requirements are met.',
      });
    }
  }

  if (action === 'remove' && existing.status === 'active') {
    errors.push({
      goalId: normalizedId,
      code: 'invalid_lifecycle',
      message: 'Cannot remove an active goal. Activate another goal or pause this goal first.',
    });
  }
}

export function validateGoalMutation(
  mutation: AgentGoalMutation,
  existingGoals: ReadonlyArray<AgentGoal>,
): GoalValidationResult {
  const errors: GoalValidationError[] = [];
  const existingIds = new Set(existingGoals.map((g) => g.id));
  const allIds = new Set(existingIds);

  for (const g of mutation.goals) {
    if (g.id?.trim()) {
      allIds.add(g.id.trim());
    }
  }

  for (let i = 0; i < mutation.goals.length; i++) {
    const g = mutation.goals[i];

    if (mutation.action === 'add') {
      if (!g.title?.trim()) {
        errors.push({
          goalId: g.id,
          code: 'missing_title',
          message: 'Goal title is required when adding.',
        });
      }
      if (!hasExplicitCompletionPolicy(g)) {
        errors.push({
          goalId: g.id,
          code: 'missing_completion_policy',
          message:
            'Goal completionPolicy is required when adding. Use blocking for finite deliverables or persistent for ongoing focus.',
        });
      }
      if (g.completionPolicy === 'blocking' && !hasStructuralSuccessCriteria(g)) {
        errors.push({
          goalId: g.id,
          code: 'missing_success_criteria',
          message: 'Blocking goals require recognized structural successCriteria when adding.',
        });
      }
      if (
        g.completionPolicy === 'blocking' &&
        hasStructuralSuccessCriteria(g) &&
        !hasSpecificSuccessCriteria(g)
      ) {
        errors.push({
          goalId: g.id,
          code: 'weak_success_criteria',
          message:
            'Blocking goals require at least one specific structural successCriteria; evidence.min and evidence.count can supplement but cannot be the only criteria.',
        });
      }
      if (g.id?.trim() && existingIds.has(g.id.trim())) {
        errors.push({
          goalId: g.id,
          code: 'duplicate_id',
          message: `Goal ID "${g.id}" already exists.`,
        });
      }
      if (g.status === 'completed' && !goalPatchMeetsTerminalCompletionRequirements(g)) {
        errors.push({
          goalId: g.id,
          code: 'evidence_required',
          message:
            'Cannot add a completed goal without satisfying structural evidence requirements.',
        });
      }
    }

    if (shouldValidateSuccessCriteria(g, existingGoals)) {
      const invalidSuccessCriteria = findInvalidSuccessCriteria(g);
      if (invalidSuccessCriteria.length > 0) {
        errors.push({
          goalId: g.id,
          code: 'invalid_success_criteria',
          message: `Unrecognized successCriteria form(s): ${invalidSuccessCriteria.join(', ')}.`,
        });
      }

      const internalGraphEvidenceCriteria = findInternalGraphEvidenceCriteria(g);
      if (internalGraphEvidenceCriteria.length > 0) {
        errors.push({
          goalId: g.id,
          code: 'invalid_success_criteria',
          message:
            'Graph-control and discovery tools cannot be used as deliverable evidence: ' +
            `${internalGraphEvidenceCriteria.join(', ')}.`,
        });
      }

      const unknownToolEvidenceCriteria = findUnknownToolEvidenceCriteria(g);
      if (unknownToolEvidenceCriteria.length > 0) {
        errors.push({
          goalId: g.id,
          code: 'invalid_success_criteria',
          message:
            'Tool evidence criteria must reference registered tools: ' +
            `${unknownToolEvidenceCriteria.join(', ')}.`,
        });
      }

      const unknownEvidencePrefixCriteria = findUnknownEvidencePrefixCriteria(g);
      if (unknownEvidencePrefixCriteria.length > 0) {
        errors.push({
          goalId: g.id,
          code: 'invalid_success_criteria',
          message:
            'evidence.prefix criteria must reference a registered tool evidence source or registered graph evidence prefix: ' +
            `${unknownEvidencePrefixCriteria.join(', ')}.`,
        });
      }
    }

    validateGoalLifecycleTransition(
      mutation.action,
      g.id,
      g.status,
      g.evidence,
      existingGoals,
      errors,
    );

    if (mutation.action === 'update' && g.status === 'active' && g.id?.trim()) {
      errors.push({
        goalId: g.id,
        code: 'invalid_update_action',
        message: 'Use activate instead of update to mark a goal active.',
      });
    }

    if (mutation.action === 'update' && g.status === 'completed' && g.id?.trim()) {
      errors.push({
        goalId: g.id,
        code: 'invalid_update_action',
        message: 'Use complete instead of update to mark a goal completed.',
      });
    }

    if (mutation.action === 'block' && g.id?.trim()) {
      validateGoalBlockTransition(g.id, existingGoals, errors);
    }

    if (mutation.action === 'add' && g.status === 'blocked') {
      errors.push({
        goalId: g.id,
        code: 'invalid_add_status',
        message: 'Cannot add a goal directly as blocked. Add as pending and activate first.',
      });
    }

    if (mutation.action === 'update' && g.status === 'blocked' && g.id?.trim()) {
      validateGoalBlockTransition(g.id, existingGoals, errors);
    }

    if (mutation.action !== 'add' && g.id?.trim()) {
      if (!existingIds.has(g.id.trim())) {
        errors.push({
          goalId: g.id,
          code: 'goal_not_found',
          message: `Goal ID "${g.id}" does not exist.`,
        });
      }
    }

    if (g.dependencies?.length) {
      for (const depId of g.dependencies) {
        if (!allIds.has(depId)) {
          errors.push({
            goalId: g.id,
            code: 'dependency_missing',
            message: `Dependency "${depId}" refers to a non-existent goal.`,
          });
        }
      }
    }
  }

  if (mutation.action === 'add') {
    const cycle = detectDependencyCycle(mutation.goals, existingGoals);
    if (cycle) {
      errors.push({
        code: 'cycle_detected',
        message: `Circular dependency detected: ${cycle.join(' → ')}.`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

function detectDependencyCycle(
  newGoals: ReadonlyArray<{ id?: string; dependencies?: string[] }>,
  existingGoals: ReadonlyArray<AgentGoal>,
): string[] | null {
  const graph = new Map<string, string[]>();

  for (const g of existingGoals) {
    graph.set(g.id, g.dependencies);
  }

  for (const g of newGoals) {
    if (g.id?.trim()) {
      graph.set(g.id.trim(), g.dependencies ?? []);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(node: string, path: string[]): string[] | null {
    if (visiting.has(node)) {
      const cycleStart = path.indexOf(node);
      return path.slice(cycleStart).concat(node);
    }
    if (visited.has(node)) return null;

    visiting.add(node);
    path.push(node);

    for (const neighbor of graph.get(node) ?? []) {
      const cycle = dfs(neighbor, path);
      if (cycle) return cycle;
    }

    path.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      const cycle = dfs(node, []);
      if (cycle) return cycle;
    }
  }

  return null;
}

export function validateGoalReferences(
  goals: ReadonlyArray<AgentGoal>,
): GoalValidationResult {
  const errors: GoalValidationError[] = [];
  const ids = new Set(goals.map((g) => g.id));

  for (const g of goals) {
    for (const depId of g.dependencies) {
      if (!ids.has(depId)) {
        errors.push({
          goalId: g.id,
          code: 'dependency_missing',
          message: `Dependency "${depId}" refers to a non-existent goal.`,
        });
      }
    }
  }

  const cycle = detectDependencyCycle([], goals);
  if (cycle) {
    errors.push({
      code: 'cycle_detected',
      message: `Circular dependency detected: ${cycle.join(' → ')}.`,
    });
  }

  return { valid: errors.length === 0, errors };
}
