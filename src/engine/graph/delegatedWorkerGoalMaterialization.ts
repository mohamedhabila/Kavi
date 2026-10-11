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
 * Opens the workstream a joined `sessions_spawn` runs under: a code-owned delegated-worker
 * goal whose criteria say a worker report is the deliverable. The worker's deliverable
 * kind and the supervisor's record of its launch and result are read from it.
 *
 * It does not touch a goal the model owns. Repair is confined to goals already owned by
 * `delegated-worker`, and creation only ever adds a new goal alongside the others.
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

/** A complete delegated-worker workstream, which a spawn runs under as-is. */
function isEligibleDedicatedWorkerGoal(goal: AgentGoal): boolean {
  return (
    goal.status !== 'completed' &&
    isBlockingGoal(goal) &&
    isDelegationOwnedGoal(goal) &&
    hasCoordinateCapability(goal) &&
    hasBothWorkerCriteria(goal)
  );
}

/** Owned by delegation and still open, but missing part of the workstream contract. */
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
