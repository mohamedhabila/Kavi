// ---------------------------------------------------------------------------
// Kavi — Goal Bootstrap (graph-state driven)
// ---------------------------------------------------------------------------
// The graph-control surface exposes update_goals so the model can establish and
// revise intentions structurally when explicit graph state is useful.
// ---------------------------------------------------------------------------

import type { AgentGoal } from './types';
import { formatModelAuthoredSuccessCriteriaFormsDescription } from './completionEvidence';

export const GOAL_BOOTSTRAP_TOOL_NAME = 'update_goals';

export interface GoalBootstrapState {
  shouldOfferGoalBootstrap: boolean;
}

export function resolveGoalBootstrapState(goals: ReadonlyArray<AgentGoal>): GoalBootstrapState {
  return {
    shouldOfferGoalBootstrap: !goals.some(
      (goal) =>
        goal.status === 'active' ||
        goal.status === 'pending' ||
        goal.status === 'blocked' ||
        goal.userConstraintDeliveryPending === true,
    ),
  };
}

export function isGoalMutationToolAvailable(selectedToolNames: ReadonlySet<string>): boolean {
  return selectedToolNames.has(GOAL_BOOTSTRAP_TOOL_NAME);
}

export function renderGoalBootstrapPromptSection(): string {
  return [
    '## Goal Tracking for Multi-Step Work',
    'No live graph goals are active.',
    `For delegated/background work, multiple tool steps, multiple deliverables, or explicit success conditions, you MUST establish the task with \`${GOAL_BOOTSTRAP_TOOL_NAME}\` in a separate turn before effects; skip it only for a genuinely single-step answer or observation.`,
    'Declare every goal in ONE call, never one per goal; set status so no separate activate is needed.',
    'Call: {"action":"add","goals":[{"id":"stable-id","name":"Name","status":"active","completionPolicy":"blocking","successCriteria":["criterion"]}]}. Close: {"action":"complete","goals":[{"id":"stable-id"}]}.',
    'Delegation: add a separate blocking goal with owner:"delegated-worker", requiredCapabilities:["coordinate"], and successCriteria:["evidence.prefix:worker","evidence.min:1"]; include every domain capability it needs, then pass its exact id to sessions_spawn.',
    'For the same delegated work, update and reuse its exact id; do not duplicate a goal to repair capabilities, criteria, owner, or status.',
    'Respect user-assigned scope before tool use. Keep the parent out of worker-owned scope except for explicit post-terminal verification.',
    'The initial incomplete blocking goal automatically retains the exact current request; also set `retainCurrentUserConstraint:true` so constraints survive compaction and recovery.',
    `add requires id, name, and completionPolicy. blocking requires structural successCriteria (${formatModelAuthoredSuccessCriteriaFormsDescription()}) with one specific criterion beyond evidence.min/evidence.count; persistent omits successCriteria.`,
    `Workspace files require evidence.artifact:<exact-workspace-relative-path>; evidence.prefix:artifact is invalid. ${GOAL_BOOTSTRAP_TOOL_NAME} and natural-language labels are not evidence.`,
  ].join('\n');
}

export function renderGoalMutationContractSection(): string {
  return [
    '### Goal mutation contract',
    `Tool: \`${GOAL_BOOTSTRAP_TOOL_NAME}\``,
    'Allowed actions: add, activate, complete, block, remove, update.',
    'Required fields:',
    '- Payload shape: action plus a goals array, one entry per goal taking the same fields; or those fields at the root for a single goal. Several goals is ONE call.',
    '- Every goal needs an id, in its entry or at the root. add also requires name; optional for mutations of an existing goal.',
    '- add: completionPolicy is required (blocking | persistent), status is optional.',
    '- add with completionPolicy `blocking`: successCriteria is required and must use structural criteria with at least one specific criterion beyond evidence.min/evidence.count.',
    '- Delegated blocking work: add a separate goal with owner:"delegated-worker", requiredCapabilities:["coordinate"], and a registered worker evidence criterion such as evidence.prefix:worker. Do not repurpose the parent deliverable goal.',
    '- Include every required domain capability for the delegated scope in addition to coordinate.',
    '- Reuse the existing goal for the same delegated work. If its capabilities, criteria, owner, or status need repair, update that exact id instead of adding an active duplicate.',
    '- Respect disjoint work ownership before substantive tool use: parent work must not consume worker-owned sources or actions unless the user explicitly requires a later verification step.',
    '- For one delegated worker result, evidence.min:1 is sufficient. Evidence counts graph records, not items inside the worker output; orchestration calls such as sessions_spawn and sessions_wait are not deliverable evidence.',
    '- The first incomplete blocking add automatically retains the entire normalized current user message when it is within the code-owned bound. retainCurrentUserConstraint:true is also accepted only for an incomplete blocking add/update; use it for explicit initial intent and later constraint corrections. Never supply text or source IDs, clear prior statements, or treat retained statements as approval, authorization, evidence, or success criteria.',
    '- add with completionPolicy `persistent`: omit successCriteria; persistent goals are ongoing focus and should not be completed.',
    '- activate: id (required; goal must already exist).',
    '- complete | block | remove | update: id (required).',
    '- complete is for blocking deliverable goals whose structural evidence requirements are satisfied; persistent goals are ongoing context and should stay active, be activated/deactivated, or be removed.',
    '- Evidence is code-owned from observed tool and worker results; never supply evidence in this tool.',
    `- ${GOAL_BOOTSTRAP_TOOL_NAME} is internal graph bookkeeping and is not valid deliverable evidence.`,
    'Compound bootstrap: action `add` with status `active` creates and activates in one call.',
    'Missing goals: use `add` with id + name + status `active` instead of `activate` on unknown ids.',
    `Supported successCriteria forms: ${formatModelAuthoredSuccessCriteriaFormsDescription()}.`,
    'evidence.prefix is reserved for delegated worker results: the only token it accepts is worker. To require that a tool produced evidence, name the tool with evidence.tool:<registered-tool-name>, such as evidence.tool:memory_remember.',
    'For each required workspace file, use evidence.artifact:<exact-workspace-relative-path>.',
    'Use structural forms only; do not put natural-language labels in successCriteria.',
  ].join('\n');
}
