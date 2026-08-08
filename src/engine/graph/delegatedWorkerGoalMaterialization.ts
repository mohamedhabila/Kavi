import type { AgentGoal } from '../../types/agentRun';
import {
  DELEGATED_WORKER_EVIDENCE_CRITERION,
  DELEGATED_WORKER_GOAL_OWNER,
  DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
  isDelegationOwnedGoal,
} from '../goals/delegation';
import { applyGoalMutation } from '../goals/graphState';
import { isBlockingGoal } from '../goals/types';
import { normalizeToolName } from '../tools/toolNameNormalization';

/**
 * Materializes the delegated-worker goal `sessions_spawn` requires, instead of refusing
 * the call until the model builds it by hand.
 *
 * `resolveDelegatedWorkerSpawnPlan` gates a spawn behind a goal of one exact shape:
 * blocking, owned by `delegated-worker`, carrying the `coordinate` capability and both
 * worker evidence criteria. When the run does not already have one it returned
 * `dedicated_worker_goal_required` and spelled the whole object out in
 * `repair.expectedShape` — a rejection whose payload is the answer, asking the model to
 * type back what the graph had already computed.
 *
 * Traced on-device, that cost a fixed round-trip every time and frequently more than
 * one: the first spawn was refused, the `update_goals` that followed landed a goal whose
 * criteria did not match, the second gate refused that too, and only the third attempt
 * spawned. It reads to a user as "spawn always fails" with duplicated, failing goal
 * updates in between, because that is exactly what it is.
 *
 * A gate that can state the required object precisely enough to serialize it does not
 * need the model to supply it. This reconciles the goal graph toward the shape the gate
 * demands and lets the spawn proceed. It is code-owned, so the model never invents the
 * delegation contract and the gate's invariants are strengthened rather than relaxed:
 * every goal it creates satisfies them by construction.
 *
 * It deliberately does not touch a goal the model owns. Repair is confined to goals
 * already owned by `delegated-worker`, and creation only ever adds a new goal alongside
 * the parent deliverable — never repurposes it, which is the case the gate exists for.
 */

export type DelegatedWorkerGoalMaterialization =
  | { status: 'unchanged'; goals: AgentGoal[] }
  | { status: 'materialized'; goals: AgentGoal[]; reason: string };

const DELEGATED_WORKER_GOAL_ID_BASE = 'delegated-workstream';

function hasCoordinateCapability(goal: AgentGoal): boolean {
  return (goal.requiredCapabilities ?? []).some((capability) => capability.trim() === 'coordinate');
}

function hasBothWorkerCriteria(goal: AgentGoal): boolean {
  const criteria = (goal.successCriteria ?? []).map((criterion) => criterion.trim());
  return (
    criteria.includes(DELEGATED_WORKER_EVIDENCE_CRITERION) &&
    criteria.includes(DELEGATED_WORKER_MIN_EVIDENCE_CRITERION)
  );
}

/** A goal the spawn gate would accept as-is. */
function isEligibleDedicatedWorkerGoal(goal: AgentGoal): boolean {
  return (
    goal.status !== 'completed' &&
    isBlockingGoal(goal) &&
    isDelegationOwnedGoal(goal) &&
    hasCoordinateCapability(goal) &&
    hasBothWorkerCriteria(goal)
  );
}

/** Owned by delegation and still open, but shaped so the gate would refuse it. */
function isRepairableDedicatedWorkerGoal(goal: AgentGoal): boolean {
  return (
    goal.status !== 'completed' &&
    isDelegationOwnedGoal(goal) &&
    !isEligibleDedicatedWorkerGoal(goal)
  );
}

function buildUnusedGoalId(goals: ReadonlyArray<AgentGoal>): string {
  const ids = new Set(goals.map((goal) => goal.id));
  if (!ids.has(DELEGATED_WORKER_GOAL_ID_BASE)) {
    return DELEGATED_WORKER_GOAL_ID_BASE;
  }
  let ordinal = 2;
  while (ids.has(`${DELEGATED_WORKER_GOAL_ID_BASE}-${ordinal}`)) {
    ordinal += 1;
  }
  return `${DELEGATED_WORKER_GOAL_ID_BASE}-${ordinal}`;
}

function mergedWorkerCriteria(goal: AgentGoal): string[] {
  const criteria = (goal.successCriteria ?? [])
    .map((criterion) => criterion.trim())
    .filter(Boolean);
  for (const required of [
    DELEGATED_WORKER_EVIDENCE_CRITERION,
    DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
  ]) {
    if (!criteria.includes(required)) {
      criteria.push(required);
    }
  }
  return criteria;
}

function mergedCoordinateCapabilities(goal: AgentGoal): string[] {
  const capabilities = (goal.requiredCapabilities ?? [])
    .map((capability) => capability.trim())
    .filter(Boolean);
  if (!capabilities.includes('coordinate')) {
    capabilities.push('coordinate');
  }
  return capabilities;
}

/**
 * A launch the supervisor deliberately detached from this request.
 *
 * `waitForCompletion:false` means control returns to the user now and no terminal worker
 * result is awaited. A blocking goal would contradict that — the run could not finalize
 * until a worker it was told not to wait for reported back — so a detached launch gets no
 * workstream. The spawn gate does not demand one for it either.
 */
function isDetachedLaunch(argumentsText: string | undefined): boolean {
  if (!argumentsText?.trim()) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { waitForCompletion?: unknown }).waitForCompletion === false
    );
  } catch {
    // Unparseable arguments fail the tool's own schema validation; treat as joined.
    return false;
  }
}

export function materializeDelegatedWorkerGoal(params: {
  toolCalls: ReadonlyArray<{ name: string; arguments?: string }>;
  goals: ReadonlyArray<AgentGoal>;
}): DelegatedWorkerGoalMaterialization {
  const goals = [...params.goals];
  const spawnsAJoinedWorker = params.toolCalls.some(
    (toolCall) =>
      normalizeToolName(toolCall.name) === 'sessions_spawn' &&
      !isDetachedLaunch(toolCall.arguments),
  );
  if (!spawnsAJoinedWorker) {
    return { status: 'unchanged', goals };
  }

  /**
   * The gate only judges a run that already has a structured goal graph
   * (`hasStructuredGoalGraph` in `resolveDelegatedWorkerSpawnPlan`). A run with no goals
   * at all is not refused for lacking a delegation goal, so opening one here would add a
   * blocking obligation to a launch that was already going to succeed.
   */
  if (goals.length === 0) {
    return { status: 'unchanged', goals };
  }

  if (goals.some(isEligibleDedicatedWorkerGoal)) {
    return { status: 'unchanged', goals };
  }

  // Prefer repairing a delegation goal the run already opened, so a spawn does not
  // accumulate a second workstream for the same work.
  const repairable = goals.find(isRepairableDedicatedWorkerGoal);
  if (repairable) {
    const repaired = applyGoalMutation(goals, {
      action: 'update',
      goals: [
        {
          id: repairable.id,
          completionPolicy: 'blocking',
          requiredCapabilities: mergedCoordinateCapabilities(repairable),
          successCriteria: mergedWorkerCriteria(repairable),
        },
      ],
    } as never);
    if (repaired.errors.length > 0) {
      return { status: 'unchanged', goals };
    }
    return {
      status: 'materialized',
      goals: repaired.goals,
      reason: `Completed the delegation contract on goal "${repairable.id}" so a worker result can be verified.`,
    };
  }

  const id = buildUnusedGoalId(goals);
  const added = applyGoalMutation(goals, {
    action: 'add',
    goals: [
      {
        id,
        title: 'Delegated workstream',
        description: 'One self-contained worker deliverable.',
        status: 'pending',
        completionPolicy: 'blocking',
        owner: DELEGATED_WORKER_GOAL_OWNER,
        requiredCapabilities: ['coordinate'],
        successCriteria: [
          DELEGATED_WORKER_EVIDENCE_CRITERION,
          DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
        ],
      },
    ],
  } as never);
  if (added.errors.length > 0) {
    return { status: 'unchanged', goals };
  }

  return {
    status: 'materialized',
    goals: added.goals,
    reason: `Opened delegated workstream "${id}" to carry the worker this turn spawns.`,
  };
}
