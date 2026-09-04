import type { AgentGoal } from '../goals/types';
import { isBlockingGoal } from '../goals/types';
import { arePersistedAgentGoalUserConstraintsCanonical } from '../goals/userConstraints';
import {
  isCountOnlySuccessCriterion,
  isRecognizedSuccessCriterionForm,
} from '../goals/completionEvidence';
import { applyGoalMutation } from '../goals/graphState';
import { MOBILE_UI_ACTION_TOOL_NAME } from './contracts';

/**
 * Owner stamp for the goal `materializeMobileControllerGoal` opens from the call
 * itself. Mirrors `CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER`
 * (`src/engine/goals/types.ts`): a `system:`-prefixed owner marks bookkeeping the
 * graph created, not something the model authored, so it is exempt from the
 * model-authored path's user-constraint requirement below — there is no user
 * intent to drift from, only one already-issued action to anchor.
 */
export const MOBILE_CONTROLLER_GOAL_OWNER = 'system:mobile-controller';
const MOBILE_CONTROLLER_GOAL_ID_BASE = 'mobile-ui-action';
const MOBILE_CONTROLLER_EVIDENCE_CRITERION = `evidence.tool:${MOBILE_UI_ACTION_TOOL_NAME}`;

function hasSpecificStructuralSuccessCondition(goal: AgentGoal): boolean {
  const criteria = goal.successCriteria ?? [];
  return (
    criteria.length > 0 &&
    criteria.every(isRecognizedSuccessCriterionForm) &&
    criteria.some((criterion) => !isCountOnlySuccessCriterion(criterion))
  );
}

/** A model-authored goal shaped exactly as the admission gate requires. */
function isAdmissibleModelAuthoredGoal(goal: AgentGoal): boolean {
  return (
    goal.status === 'active' &&
    isBlockingGoal(goal) &&
    hasSpecificStructuralSuccessCondition(goal) &&
    goal.userConstraintIntegrity !== 'conflict' &&
    arePersistedAgentGoalUserConstraintsCanonical(goal.userConstraints)
  );
}

/**
 * A goal `materializeMobileControllerGoal` opened from the `mobile_ui_action` call
 * itself. It carries the one evidence criterion the call's own effect satisfies, so
 * completion is anchored the moment the action runs — no model-authored user
 * constraint applies to code-owned bookkeeping.
 */
function isAdmissibleCodeOwnedMobileControllerGoal(goal: AgentGoal): boolean {
  return (
    goal.status === 'active' &&
    isBlockingGoal(goal) &&
    goal.owner === MOBILE_CONTROLLER_GOAL_OWNER &&
    (goal.successCriteria ?? []).includes(MOBILE_CONTROLLER_EVIDENCE_CRITERION)
  );
}

export function hasGraphAnchoredMobileControllerGoal(
  goals: ReadonlyArray<AgentGoal> | undefined,
): boolean {
  return (goals ?? []).some(
    (goal) => isAdmissibleCodeOwnedMobileControllerGoal(goal) || isAdmissibleModelAuthoredGoal(goal),
  );
}

export function buildMobileControllerGoalAdmissionBlock(
  goals: ReadonlyArray<AgentGoal> | undefined,
): string | undefined {
  if (hasGraphAnchoredMobileControllerGoal(goals)) return undefined;

  return JSON.stringify({
    status: 'error',
    code: 'mobile_controller_goal_required',
    tool: MOBILE_UI_ACTION_TOOL_NAME,
    repair: {
      retryable: true,
      code: 'mobile_controller_goal_required',
      tool: 'update_goals',
      requiredGoal: {
        status: 'active',
        completionPolicy: 'blocking',
        retainCurrentUserConstraint: true,
        minimumSuccessCriteria: 1,
        specificStructuralCriterionRequired: true,
      },
    },
    message:
      'Before using mobile_ui_action, call update_goals in a separate turn to create or update an active blocking goal with at least one recognized, non-count-only structural success criterion and retainCurrentUserConstraint:true.',
  });
}

function buildUnusedGoalId(goals: ReadonlyArray<AgentGoal>): string {
  const ids = new Set(goals.map((goal) => goal.id));
  if (!ids.has(MOBILE_CONTROLLER_GOAL_ID_BASE)) {
    return MOBILE_CONTROLLER_GOAL_ID_BASE;
  }
  let ordinal = 2;
  while (ids.has(`${MOBILE_CONTROLLER_GOAL_ID_BASE}-${ordinal}`)) {
    ordinal += 1;
  }
  return `${MOBILE_CONTROLLER_GOAL_ID_BASE}-${ordinal}`;
}

/**
 * Structurally describes a `mobile_ui_action` call's target, for the goal title
 * only — field extraction from the tool's own typed arguments, never free-text
 * interpretation. `open_app` names the app; an element or coordinate target names
 * the element or the point; anything else falls back to the action kind alone.
 */
function describeMobileControllerActionTarget(action: Record<string, unknown>): string {
  if (typeof action.appId === 'string' && action.appId.trim()) {
    return action.appId.trim();
  }
  const target = action.target;
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const targetRecord = target as Record<string, unknown>;
    if (typeof targetRecord.elementId === 'string' && targetRecord.elementId.trim()) {
      return targetRecord.elementId.trim();
    }
    if (typeof targetRecord.x === 'number' && typeof targetRecord.y === 'number') {
      return `${targetRecord.x},${targetRecord.y}`;
    }
  }
  if (typeof action.direction === 'string' && action.direction.trim()) {
    return action.direction.trim();
  }
  return typeof action.kind === 'string' && action.kind.trim() ? action.kind.trim() : 'action';
}

function buildMobileControllerGoalTitle(argumentsText: string | undefined): string {
  if (!argumentsText?.trim()) {
    return `Mobile UI action: ${MOBILE_UI_ACTION_TOOL_NAME}`;
  }
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return `Mobile UI action: ${describeMobileControllerActionTarget(parsed as Record<string, unknown>)}`;
    }
  } catch {
    // Unparseable arguments fail the tool's own schema validation; fall through to
    // the generic title so materialization still anchors the call.
  }
  return `Mobile UI action: ${MOBILE_UI_ACTION_TOOL_NAME}`;
}

export type MobileControllerGoalMaterialization =
  | { status: 'unchanged'; goals: AgentGoal[] }
  | { status: 'materialized'; goals: AgentGoal[]; reason: string };

/**
 * Materializes the bookkeeping goal `mobile_ui_action` requires, instead of
 * refusing the call until the model builds one by hand.
 *
 * The admission gate only ever needed one thing: an active blocking goal anchored
 * to this exact call, carrying `evidence.tool:mobile_ui_action`. A gate that can
 * state that shape precisely enough to serialize it does not need the model to
 * supply it — reconciling it here lets the very first `mobile_ui_action` call in a
 * conversation succeed instead of being rejected and asked to type back the goal
 * the graph already knows how to build. It deliberately never touches a goal the
 * model owns; when one already admits the call (model-authored or a previous
 * code-owned goal from this same tool), this is a no-op.
 */
export function materializeMobileControllerGoal(params: {
  toolCalls: ReadonlyArray<{ name: string; arguments?: string }>;
  goals: ReadonlyArray<AgentGoal>;
}): MobileControllerGoalMaterialization {
  const goals = [...params.goals];
  const mobileControllerCall = params.toolCalls.find(
    (toolCall) => toolCall.name === MOBILE_UI_ACTION_TOOL_NAME,
  );
  if (!mobileControllerCall) {
    return { status: 'unchanged', goals };
  }

  if (hasGraphAnchoredMobileControllerGoal(goals)) {
    return { status: 'unchanged', goals };
  }

  const id = buildUnusedGoalId(goals);
  const added = applyGoalMutation(goals, {
    action: 'add',
    goals: [
      {
        id,
        title: buildMobileControllerGoalTitle(mobileControllerCall.arguments),
        status: 'active',
        completionPolicy: 'blocking',
        owner: MOBILE_CONTROLLER_GOAL_OWNER,
        requiredCapabilities: ['mobile_ui'],
        successCriteria: [MOBILE_CONTROLLER_EVIDENCE_CRITERION],
      },
    ],
  } as never);
  if (added.errors.length > 0) {
    return { status: 'unchanged', goals };
  }

  return {
    status: 'materialized',
    goals: added.goals,
    reason: `Opened mobile controller goal "${id}" to anchor this device action.`,
  };
}
