import type { AgentGoal } from '../goals/types';
import { isBlockingGoal } from '../goals/types';
import { applyGoalMutation } from '../goals/graphState';
import { MOBILE_UI_ACTION_TOOL_NAME } from './contracts';

/**
 * Owner stamp for the goal `materializeMobileControllerGoal` opens from the call
 * itself. Mirrors `CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER`
 * (`src/engine/goals/types.ts`): a `system:`-prefixed owner marks bookkeeping the
 * graph created, not something the model authored.
 */
export const MOBILE_CONTROLLER_GOAL_OWNER = 'system:mobile-controller';
const MOBILE_CONTROLLER_GOAL_ID_BASE = 'mobile-ui-action';
const MOBILE_CONTROLLER_EVIDENCE_CRITERION = `evidence.tool:${MOBILE_UI_ACTION_TOOL_NAME}`;

/**
 * A goal `materializeMobileControllerGoal` opened from a `mobile_ui_action` call. It
 * carries the one evidence criterion the call's own effect satisfies.
 */
function isCodeOwnedMobileControllerGoal(goal: AgentGoal): boolean {
  return (
    goal.status === 'active' &&
    isBlockingGoal(goal) &&
    goal.owner === MOBILE_CONTROLLER_GOAL_OWNER &&
    (goal.successCriteria ?? []).includes(MOBILE_CONTROLLER_EVIDENCE_CRITERION)
  );
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
 * Records a `mobile_ui_action` call as a code-owned goal, the run's record that a device
 * action is under way. It never touches a goal the model owns, and one goal covers every
 * later call in the same run.
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

  if (goals.some(isCodeOwnedMobileControllerGoal)) {
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
