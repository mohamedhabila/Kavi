// ---------------------------------------------------------------------------
// Kavi — Goal Mutation Validation
// ---------------------------------------------------------------------------
// Structural validation for goal mutations. No English heuristics.
// Pure graph logic: cycle detection, duplicate ID prevention, referential
// integrity.
// ---------------------------------------------------------------------------

import { evaluateGoalEvidenceGaps, isSuccessCriterionMet } from './completionEvidence';
import type { AgentGoal, AgentGoalMutation, AgentGoalStatus } from './types';
import { createGoal, isBlockingGoal } from './types';
import {
  validateGoalConstraintMutationCapacity,
  validateGoalConstraintRemoval,
  validateGoalUserConstraints,
  type GoalMutationValidationContext,
} from './goalUserConstraintValidation';
import { validateBlockingGoalUpdate } from './blockingGoalUpdateValidation';
import { assessGoalInfeasibilityClaim } from './infeasibility';
import {
  findCodeOwnedEvidence,
  findInternalGraphEvidenceCriteria,
  findInvalidSuccessCriteria,
  findUnknownEvidencePrefixCriteria,
  findMisdirectedJsonFieldCriteria,
  findUnsatisfiableStructuralCriteria,
  findUnknownToolEvidenceCriteria,
  formatRegisteredNonToolEvidencePrefixes,
  hasStructuralSuccessCriteria,
  shouldValidateSuccessCriteria,
} from './successCriteriaInspection';

export type { GoalMutationValidationContext } from './goalUserConstraintValidation';

export type GoalValidationErrorCode =
  | 'missing_title'
  | 'missing_completion_policy'
  | 'missing_success_criteria'
  | 'weak_success_criteria'
  | 'invalid_success_criteria'
  | 'invalid_evidence'
  | 'goal_not_found'
  | 'duplicate_id'
  | 'dependency_missing'
  | 'cycle_detected'
  | 'invalid_lifecycle'
  | 'evidence_required'
  | 'evidence_satisfied'
  | 'invalid_block'
  | 'invalid_update_action'
  | 'invalid_add_status'
  | 'invalid_user_constraints'
  | 'duplicate_user_constraints'
  | 'ungrounded_user_constraints'
  | 'unsupported_user_constraints';

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

function hasExplicitCompletionPolicy(patch: AgentGoalMutation['goals'][number]): boolean {
  return patch.completionPolicy === 'blocking' || patch.completionPolicy === 'persistent';
}

function validateGoalBlockTransition(
  goalId: string | undefined,
  existingGoals: ReadonlyArray<AgentGoal>,
  errors: GoalValidationError[],
  context: GoalMutationValidationContext,
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
    if (evidenceSatisfied) {
      errors.push({
        goalId: normalizedId,
        code: 'evidence_satisfied',
        message:
          'Cannot block a goal whose structural evidence requirements are already satisfied. Complete it instead.',
      });
      return;
    }

    // Blocking a blocking goal was previously refused unconditionally, which left
    // an agent that had genuinely run out of options with no sanctioned move: it
    // could not finalize, complete, or abandon. The observable result was repeated
    // update_goals calls until loop detection terminated the run as a hard failure.
    // Abandonment is now reachable, but only once every available path has actually
    // been tried; an unearned claim is refused with the concrete step that remains.
    const assessment = assessGoalInfeasibilityClaim({
      toolCallHistory: context.toolCallHistory ?? [],
      capabilityToolNames: context.capabilityToolNames ?? [],
      clarificationToolName: context.clarificationToolName,
    });
    if (!assessment.accepted) {
      errors.push({
        goalId: normalizedId,
        code: 'evidence_required',
        message: assessment.message,
      });
    }
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

  if (
    existing.status === 'completed' &&
    (action === 'activate' ||
      (action === 'update' && (nextStatus === 'active' || nextStatus === 'pending')))
  ) {
    errors.push({
      goalId: normalizedId,
      code: 'invalid_lifecycle',
      message: 'Completed goals cannot be reactivated; create a new goal for repeated work.',
    });
    return;
  }

  if (action === 'complete' || (action === 'update' && nextStatus === 'completed')) {
    const extraEvidence = action === 'complete' ? (patchEvidence ?? []) : [];

    // Completing an already-completed goal is the state the caller asked for, so it
    // succeeds rather than erroring. Rejecting it left no legal move: the engine
    // auto-completes a goal the moment its criteria are satisfied, so a model that
    // then said "complete" was told to activate first, and activating was refused
    // because completed goals cannot be reactivated. Traced on device and in the
    // evaluation suite as a run that ground through five update_goals calls against
    // that contradiction. Any tool whose result satisfies a goal can reach it.
    if (existing.status === 'completed') {
      return;
    }

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

    /**
     * Closing a goal is the model's bookkeeping, not its claim of proof, so it is not
     * refused for want of evidence or for the goal not being focused first.
     *
     * Both refusals used to live here — "Use activate first" for a pending goal, and an
     * evidence veto for an active one — and together they produced the loop they were
     * meant to prevent. Traced live on an Android emulator across a 24-call run:
     *
     *   complete mc-npv                     x4 consecutively
     *   complete [report, sensitivity, ...] x4
     *   activate mc-npv -> complete mc-npv  (the reactivation the refusal forced)
     *
     * The completes did not stick, so the model re-ran python and rewrote files trying
     * to manufacture evidence the gate would accept, and the run ended in
     * loop_detected. Nothing in that sequence was the model reasoning badly; it was
     * responding to a control plane that would not let it record its own progress.
     *
     * Refusing here never protected finalization, which evaluates the criteria itself:
     * areBlockingGoalsStructurallyComplete requires `areGoalSuccessCriteriaSatisfied`
     * alongside the completed status, so a goal closed without evidence still cannot
     * carry a run to a successful finish. The veto was redundant, and its only
     * observable effect was the churn above.
     *
     * The result still reports which criteria are outstanding, so the model can see
     * exactly what remains — as information it acts on, rather than a refusal it has to
     * fight.
     */
    return;
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
  context: GoalMutationValidationContext = {},
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
    errors.push(
      ...validateGoalUserConstraints({
        action: mutation.action,
        patch: g,
        existingGoals,
        context,
      }),
    );
    const codeOwnedEvidence = findCodeOwnedEvidence(g);
    if (codeOwnedEvidence.length > 0) {
      errors.push({
        goalId: g.id,
        code: 'invalid_evidence',
        message:
          'Tool effect receipt evidence is code-owned and cannot be supplied by update_goals.',
      });
    }

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
      /**
       * There is deliberately no companion rule demanding that the criterion be a
       * *specific* one. How strong to make a gate is the model's judgement: `evidence.min:1`
       * is weaker than `evidence.artifact:<path>`, but `resolveGatingSuccessCriteria` falls
       * back to a count when nothing specific is declared, so finalization still evaluates
       * it and still refuses a run that recorded no evidence. Rejecting the weaker form
       * discarded the entire batch — every well-formed goal alongside the weak one — and
       * left the run with no graph at all, which is the outcome the rule meant to prevent.
       * Traced live on an Android emulator over a five-goal opening batch:
       * "[verify] Blocking goals require at least one specific structural successCriteria".
       *
       * A goal with no recognized criterion at all is the different case this rule keeps:
       * `areBlockingGoalsStructurallyComplete` requires a non-empty criteria list, so such
       * a goal is not a weak gate but one nothing can ever open. Normalization admits it as
       * the ongoing focus it describes before validation sees it, so this message is
       * reached only by a caller that validates without normalizing first.
       */
      if (g.completionPolicy === 'blocking' && !hasStructuralSuccessCriteria(g)) {
        errors.push({
          goalId: g.id,
          code: 'missing_success_criteria',
          // Naming only the rule left no legal move for a goal that has no verifiable
          // deliverable — the caller cannot invent a structural criterion for "track this
          // topic", and retrying the same shape is then the only option it can see. Both
          // ways out are stated so a single rejection is recoverable.
          message:
            'Blocking goals require recognized structural successCriteria when adding. ' +
            'Either declare a structural criterion describing the deliverable, or use ' +
            'completionPolicy "persistent" if this goal is an ongoing focus with nothing ' +
            'to verify. Re-sending this goal unchanged will be rejected the same way.',
        });
      }
      if (g.id?.trim() && existingIds.has(g.id.trim())) {
        errors.push({
          goalId: g.id,
          code: 'duplicate_id',
          message: `Goal ID "${g.id}" already exists.`,
        });
      }
      if (g.status === 'completed') {
        errors.push({
          goalId: g.id,
          code: 'invalid_add_status',
          message:
            'Add goals as pending or active, then use complete for the canonical transition.',
        });
      }
    }

    if (mutation.action === 'update') {
      errors.push(...validateBlockingGoalUpdate(g, existingGoals));
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

      const unsatisfiableStructuralCriteria = findUnsatisfiableStructuralCriteria(g);
      if (unsatisfiableStructuralCriteria.length > 0) {
        errors.push({
          goalId: g.id,
          code: 'invalid_success_criteria',
          message:
            'Structural criteria name a resource, not a description, and their operand ' +
            'must be a single workspace path or field reference: ' +
            `${unsatisfiableStructuralCriteria.join(', ')}. A criterion that cannot match ` +
            'any evidence would gate this goal permanently, because criteria on a blocking ' +
            'goal cannot be removed once accepted.',
        });
      }

      const misdirectedJsonFieldCriteria = findMisdirectedJsonFieldCriteria(g);
      if (misdirectedJsonFieldCriteria.length > 0) {
        errors.push({
          goalId: g.id,
          code: 'invalid_success_criteria',
          message:
            'evidence.json_field reads a field out of a JSON payload, so its first ' +
            'operand is a dotted field path such as `calendar.allowsModifications`, not ' +
            'a file path: ' +
            `${misdirectedJsonFieldCriteria.join(', ')}. To assert a workspace file ` +
            'exists use evidence.artifact:<path>, or evidence.file_hash:<path>:<algo> to ' +
            'pin its contents. A field path naming a file matches nothing and could not ' +
            'be withdrawn once accepted.',
        });
      }

      const unknownEvidencePrefixCriteria = findUnknownEvidencePrefixCriteria(g);
      if (unknownEvidencePrefixCriteria.length > 0) {
        errors.push({
          goalId: g.id,
          code: 'invalid_success_criteria',
          message:
            // The operand names the *source* of the evidence — the tool that produced
            // it — not text the evidence should contain. "prefix" reads naturally as the
            // latter, and that is the misuse actually observed: six runs in eight passed
            // the expected file content here, were refused, and spent a call recovering.
            // Naming both the domain and the criterion that does assert content ends it
            // in one exchange instead of by trial.
            // Naming the category was not enough to place the token: traced on-device,
            // runs guessed `evidence.prefix:output` and `evidence.prefix:edit`, were
            // refused, and spent a second call each recovering. There is exactly one
            // non-tool prefix, so the set is enumerated rather than described.
            'evidence.prefix names the source that produced the evidence — a registered ' +
            `tool name, or one of: ${formatRegisteredNonToolEvidencePrefixes()} — not text ` +
            `the evidence should contain: ${unknownEvidencePrefixCriteria.join(', ')}. To assert that a ` +
            'workspace file exists use evidence.artifact:<exact-workspace-relative-path>; ' +
            'to assert its exact contents use evidence.file_hash:<path>:<algo>[:<hex>]; to ' +
            'require that a particular tool produced evidence use evidence.tool:<name>.',
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

    if (mutation.action === 'update' && g.status === 'completed' && g.id?.trim()) {
      errors.push({
        goalId: g.id,
        code: 'invalid_update_action',
        message: 'Use complete instead of update to mark a goal completed.',
      });
    }

    if (mutation.action === 'block' && g.id?.trim()) {
      validateGoalBlockTransition(g.id, existingGoals, errors, context);
    }

    if (mutation.action === 'add' && g.status === 'blocked') {
      errors.push({
        goalId: g.id,
        code: 'invalid_add_status',
        message: 'Cannot add a goal directly as blocked. Add as pending and activate first.',
      });
    }

    if (mutation.action === 'update' && g.status === 'blocked' && g.id?.trim()) {
      validateGoalBlockTransition(g.id, existingGoals, errors, context);
    }

    if (mutation.action !== 'add' && g.id?.trim()) {
      if (!existingIds.has(g.id.trim())) {
        errors.push({
          goalId: g.id,
          code: 'goal_not_found',
          message: `Goal ID "${g.id}" does not exist. Use action add to create it, or reference an existing goal ID from the current goal list.`,
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

  if (mutation.action === 'remove') {
    for (const removalError of validateGoalConstraintRemoval(mutation, existingGoals)) {
      if (
        errors.some(
          (error) => error.goalId === removalError.goalId && error.code === removalError.code,
        )
      ) {
        continue;
      }
      errors.push(removalError);
    }
  }

  errors.push(...validateGoalConstraintMutationCapacity(mutation, existingGoals));

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

export function validateGoalReferences(goals: ReadonlyArray<AgentGoal>): GoalValidationResult {
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
