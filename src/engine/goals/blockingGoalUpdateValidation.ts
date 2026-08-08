import {
  isCountOnlySuccessCriterion,
  isRecognizedSuccessCriterionForm,
} from './completionEvidence';
import {
  isBlockingGoal,
  resolveGoalCompletionPolicy,
  type AgentGoal,
  type AgentGoalMutation,
} from './types';

export type BlockingGoalUpdateValidationError = Readonly<{
  goalId?: string;
  code:
    | 'invalid_lifecycle'
    | 'invalid_success_criteria'
    | 'missing_success_criteria'
    | 'weak_success_criteria';
  message: string;
}>;

export function validateBlockingGoalUpdate(
  patch: AgentGoalMutation['goals'][number],
  existingGoals: ReadonlyArray<AgentGoal>,
): BlockingGoalUpdateValidationError[] {
  const goalId = patch.id?.trim();
  if (!goalId) return [];
  const existing = existingGoals.find((goal) => goal.id === goalId);
  if (!existing) return [];
  const errors: BlockingGoalUpdateValidationError[] = [];
  const nextPolicy = patch.completionPolicy ?? resolveGoalCompletionPolicy(existing);
  if (isBlockingGoal(existing) && nextPolicy === 'persistent') {
    errors.push({
      goalId,
      code: 'invalid_lifecycle',
      message: 'A blocking goal cannot be converted to persistent to evade completion.',
    });
    return errors;
  }
  if (nextPolicy !== 'blocking') return errors;

  const effectiveCriteria = patch.successCriteria ?? existing.successCriteria ?? [];
  const recognizedCriteria = effectiveCriteria.filter(isRecognizedSuccessCriterionForm);
  if (recognizedCriteria.length === 0) {
    errors.push({
      goalId,
      code: 'missing_success_criteria',
      message: 'A blocking goal update must retain recognized structural successCriteria.',
    });
  } else if (recognizedCriteria.every(isCountOnlySuccessCriterion)) {
    errors.push({
      goalId,
      code: 'weak_success_criteria',
      message:
        'A blocking goal update must retain at least one specific structural success criterion.',
    });
  }

  if (isBlockingGoal(existing) && patch.successCriteria !== undefined) {
    const proposedCriteria = new Set(patch.successCriteria);
    // Structural criteria are monotonic because dropping one discards proof of a
    // deliverable. A count carries no such proof: the engine already refuses to accept
    // `evidence.min:N` as a blocking goal's deliverable and refuses to let one be
    // appended below, so locking it permanently guards nothing while making a goal
    // unwinnable the moment the declared number exceeds what the work yields. Traced
    // live: a goal declared `evidence.min:2` for work producing one evidence entry, and
    // could neither reach two nor revise down — twelve identical refusals, run blocked,
    // with the deliverable correct on disk the whole time. Revising a count stays legal;
    // dropping a criterion that names a deliverable does not.
    const removedCriteria = (existing.successCriteria ?? []).filter(
      (criterion) =>
        !proposedCriteria.has(criterion) && !isCountOnlySuccessCriterion(criterion),
    );
    const existingCriteria = new Set(existing.successCriteria ?? []);
    /**
     * A count may join a goal that keeps a specific criterion, but never become its gate.
     *
     * Refusing every added count made the delegation contract impossible to satisfy by
     * update. `sessions_spawn` requires `evidence.prefix:worker` *and* `evidence.min:1`,
     * and its own repair payload tells the model to send both — so a model that followed
     * the instruction exactly had the call rejected here, retried, and was rejected
     * again. Traced live as repeated failing `update_goals` calls around a spawn that
     * never launched.
     *
     * The hazard the refusal guards against is a count becoming the thing that holds a
     * goal open, which is how a goal turns unwinnable. That cannot happen beside a
     * specific criterion: `resolveGatingSuccessCriteria` drops counts from gating
     * whenever one is present, so the added count is inert for completion and serves
     * only to record how many results the goal expects. A count added to a goal with no
     * specific criterion is still refused, because there it would be the gate.
     */
    const retainsSpecificCriterion = patch.successCriteria.some(
      (criterion) =>
        isRecognizedSuccessCriterionForm(criterion) && !isCountOnlySuccessCriterion(criterion),
    );
    const unsupportedAdditions = patch.successCriteria.filter((criterion) => {
      if (existingCriteria.has(criterion)) {
        return false;
      }
      if (!isRecognizedSuccessCriterionForm(criterion)) {
        return true;
      }
      return isCountOnlySuccessCriterion(criterion) && !retainsSpecificCriterion;
    });
    if (removedCriteria.length > 0 || unsupportedAdditions.length > 0) {
      errors.push({
        goalId,
        code: 'invalid_success_criteria',
        message:
          'Blocking goal successCriteria are monotonic: retain every existing criterion exactly and append only recognized specific criteria.',
      });
    }
  }
  return errors;
}
