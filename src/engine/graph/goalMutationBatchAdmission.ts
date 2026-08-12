// ---------------------------------------------------------------------------
// Kavi — Goal Mutation Batch Admission
// ---------------------------------------------------------------------------
// Decides whether an effect batched alongside update_goals may run in the same
// turn, instead of being bounced to the next graph iteration.
//
// A goal mutation commits during outcome resolution, after the batch has run, so
// the admission check inside the batch can only see the pre-mutation graph. The
// original rule refused every effect batched with a mutation for that reason.
//
// Traced live on an Android emulator: the model batched `update_goals` with the
// `write_file` that mutation admitted, the write was refused with
// goal_mutation_boundary, and the identical 1203-byte call was re-sent on the
// next iteration, where it succeeded. The batch had been correct the first time;
// the refusal cost a round-trip and taught nothing.
//
// Projecting the batch's own mutations answers the question without committing
// anything early. `applyGoalMutation` runs the same validation canonicalization
// will run and returns the goals untouched when a mutation is invalid, so a
// mutation destined for rejection projects nothing and the effect stays blocked
// exactly as before.
// ---------------------------------------------------------------------------

import type { AgentGoal } from '../../types/agentRun';
import { GOAL_BOOTSTRAP_TOOL_NAME } from '../goals/bootstrap';
import { applyGoalMutation } from '../goals/graphState';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { parseUpdateGoalsArgs } from '../tools/toolGoalExecution';
import { parseToolArgumentsJson } from '../toolExecution/toolArgumentJsonRecovery';
import {
  findGoalForEffectCompletionRequirement,
  type ToolEffectCompletionRequirement,
} from '../toolExecution/toolEffectCompletionContract';

interface BatchToolCall {
  readonly name: string;
  readonly arguments: string;
}

function isGoalMutationCall(toolCall: BatchToolCall): boolean {
  return normalizeToolName(toolCall.name) === GOAL_BOOTSTRAP_TOOL_NAME;
}

/** Index of the last goal mutation in the batch, or -1 when there is none. */
export function resolveLastGoalMutationIndex(
  toolCalls: ReadonlyArray<BatchToolCall>,
): number {
  return toolCalls.reduce(
    (last, toolCall, index) => (isGoalMutationCall(toolCall) ? index : last),
    -1,
  );
}

/**
 * The graph as it will stand once this batch's goal mutations commit. Mutations that
 * fail validation, or whose arguments do not parse, contribute nothing.
 */
export function projectInBatchGoalMutations(
  toolCalls: ReadonlyArray<BatchToolCall>,
  goals: ReadonlyArray<AgentGoal> | undefined,
): ReadonlyArray<AgentGoal> {
  return toolCalls.reduce<ReadonlyArray<AgentGoal>>((projected, toolCall) => {
    if (!isGoalMutationCall(toolCall)) {
      return projected;
    }

    try {
      const args = parseToolArgumentsJson(toolCall.arguments);
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        return projected;
      }

      const parsed = parseUpdateGoalsArgs(args as Record<string, unknown>);
      if (parsed.errors.length > 0) {
        return projected;
      }

      const applied = applyGoalMutation(projected, parsed.mutation);
      return applied.errors.length > 0 ? projected : applied.goals;
    } catch {
      return projected;
    }
  }, goals ?? []);
}

/**
 * Whether an effect may run beside the mutation that admits it.
 *
 * Requires the mutation to be declared earlier in the batch, so it resolves — and
 * commits — before this effect's own outcome, and requires the projected graph to
 * already admit the effect. Anything else keeps the original boundary.
 */
export function isEffectAdmittedByBatchGoalMutation(params: {
  index: number;
  lastGoalMutationIndex: number;
  requirement: ToolEffectCompletionRequirement;
  projectedGoals: ReadonlyArray<AgentGoal>;
  committedGoals?: ReadonlyArray<AgentGoal>;
}): boolean {
  /**
   * An operational call has no admitting goal to wait for, so the boundary protects
   * nothing by holding it back — the surrounding code lets it through unconditionally
   * whenever the batch happens to contain no goal mutation.
   *
   * Traced live on an Android emulator: python declares completionMode "operational", was
   * batched with an update_goals, and was refused with goal_mutation_boundary. Nothing
   * about that mutation had any bearing on whether the computation could run.
   */
  if (params.requirement.kind === 'operational') {
    return true;
  }
  if (params.requirement.kind !== 'effectful') {
    return false;
  }

  /**
   * An effect the committed graph already admits does not depend on the batch's mutation
   * at all, so its position in the batch is irrelevant. Requiring it to come after the
   * mutation refused a write that was declared first and would have run on its own —
   * traced on device as a second goal_mutation_boundary in the same run.
   */
  if (
    params.committedGoals &&
    findGoalForEffectCompletionRequirement(params.committedGoals, params.requirement)
  ) {
    return true;
  }

  // Otherwise admission comes from this batch's own mutation, which must therefore be
  // declared earlier so it resolves — and commits — before this effect's outcome.
  if (params.index <= params.lastGoalMutationIndex) {
    return false;
  }
  return Boolean(
    findGoalForEffectCompletionRequirement(params.projectedGoals, params.requirement),
  );
}
