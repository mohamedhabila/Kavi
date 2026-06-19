// ---------------------------------------------------------------------------
// Kavi — Goal Bootstrap (graph-state driven)
// ---------------------------------------------------------------------------
// The graph-control surface exposes update_goals so the model can establish and
// revise intentions structurally when explicit graph state is useful.
// ---------------------------------------------------------------------------

import type { AgentGoal } from './types';
import { formatSuccessCriteriaFormsDescription } from './completionEvidence';

export const GOAL_BOOTSTRAP_TOOL_NAME = 'update_goals';

export interface GoalBootstrapState {
  shouldOfferGoalBootstrap: boolean;
}

export function resolveGoalBootstrapState(
  goals: ReadonlyArray<AgentGoal>,
): GoalBootstrapState {
  return {
    shouldOfferGoalBootstrap: !goals.some(
      (goal) =>
        goal.status === 'active' || goal.status === 'pending' || goal.status === 'blocked',
    ),
  };
}

export function isGoalMutationToolAvailable(
  selectedToolNames: ReadonlySet<string>,
): boolean {
  return selectedToolNames.has(GOAL_BOOTSTRAP_TOOL_NAME);
}

export function renderGoalBootstrapPromptSection(): string {
  return [
    '## Optional Goal Tracking',
    'No live graph goals are active.',
    `Use \`${GOAL_BOOTSTRAP_TOOL_NAME}\` for deliverables, delegated workstreams, persistent focus, or declared goals with criteria/capabilities.`,
    'If no blocking deliverable or persistent focus is needed, continue without creating goals.',
    'Call shape: {"action":"add","id":"stable-id","name":"Visible name","completionPolicy":"blocking|persistent","status":"active|pending"}.',
    'add requires id, name, and completionPolicy (`blocking` finite deliverable, `persistent` ongoing focus).',
    `blocking add requires structural successCriteria (${formatSuccessCriteriaFormsDescription()}) with at least one specific criterion beyond evidence.min/evidence.count.`,
    'persistent add omits successCriteria; persistent goals are ongoing focus, not deliverables.',
    `Do not use ${GOAL_BOOTSTRAP_TOOL_NAME} or natural-language labels as successCriteria evidence.`,
  ].join('\n');
}

export function renderGoalMutationContractSection(): string {
  return [
    '### Goal mutation contract',
    `Tool: \`${GOAL_BOOTSTRAP_TOOL_NAME}\``,
    'Allowed actions: add, activate, complete, block, remove, update.',
    'Required fields:',
    '- Payload shape: one goal mutation with root fields: action, id, name, status, completionPolicy, successCriteria, evidence, dependencies.',
    '- All actions: id and name are required; for existing goals, repeat the visible name.',
    '- add: completionPolicy is required (blocking | persistent), status is optional.',
    '- add with completionPolicy `blocking`: successCriteria is required and must use structural criteria with at least one specific criterion beyond evidence.min/evidence.count.',
    '- add with completionPolicy `persistent`: omit successCriteria; persistent goals are ongoing focus and should not be completed.',
    '- activate: id (required; goal must already exist).',
    '- complete | block | remove | update: id (required).',
    '- complete is for blocking deliverable goals whose structural evidence requirements are satisfied; persistent goals are ongoing context and should stay active, be activated/deactivated, or be removed.',
    `- ${GOAL_BOOTSTRAP_TOOL_NAME} is internal graph bookkeeping and is not valid deliverable evidence.`,
    'Compound bootstrap: action `add` with status `active` creates and activates in one call.',
    'Missing goals: use `add` with id + name + status `active` instead of `activate` on unknown ids.',
    `Supported successCriteria forms: ${formatSuccessCriteriaFormsDescription()}.`,
    'For evidence.prefix, use a registered evidence source such as a tool name or worker.',
    'Use structural forms only; do not put natural-language labels in successCriteria.',
  ].join('\n');
}
