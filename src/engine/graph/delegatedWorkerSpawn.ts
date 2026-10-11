import type { AgentGoal, AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import type { SubAgentSnapshot } from '../../types/subAgent';
import {
  evaluateMobileSpawnPreflight,
  resolveSpawnWorkstream,
} from '../../services/agents/mobileSpawnPolicy';
import { isBlockingGoal } from '../goals/types';
import { arePersistedAgentGoalUserConstraintsCanonical } from '../goals/userConstraints';
import { isDelegationOwnedGoal, readDelegatedWorkerLaunchSessionId } from '../goals/delegation';

export interface DelegatedWorkerSpawnRequest {
  prompt: string;
  name?: string;
  workstreamId?: string;
  dependsOnWorkstreams?: string[];
  depth?: number;
}

export interface DelegatedWorkerSpawnGate {
  workstreamId?: string;
  status: 'ready' | 'blocked';
  error?: string;
}

export interface DelegatedWorkerSpawnPlan {
  status: 'ready' | 'error' | 'blocked';
  activeRun?: AgentRun;
  goals: ReadonlyArray<AgentGoal>;
  spawnGate: DelegatedWorkerSpawnGate;
  response?: Record<string, unknown>;
}

function hasCoordinateCapability(goal: AgentGoal): boolean {
  return (goal.requiredCapabilities ?? []).some((capability) => capability.trim() === 'coordinate');
}

function isIncompleteDedicatedWorkerGoal(goal: AgentGoal): boolean {
  return (
    goal.status !== 'completed' &&
    isBlockingGoal(goal) &&
    isDelegationOwnedGoal(goal) &&
    hasCoordinateCapability(goal)
  );
}

function resolveDelegatedWorkerActiveRun(
  conversation: Conversation | undefined,
  agentRunId: string | undefined,
): AgentRun | undefined {
  if (!conversation?.agentRuns?.length) {
    return undefined;
  }
  if (agentRunId?.trim()) {
    return conversation.agentRuns.find((run) => run.id === agentRunId.trim());
  }
  return [...conversation.agentRuns].sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

function buildRepairableSpawnArgumentError(params: {
  code: string;
  error: string;
  invalidFields: string[];
  expectedArguments?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    status: 'error',
    code: params.code,
    error: params.error,
    repair: {
      retryable: true,
      code: params.code,
      invalidFields: params.invalidFields,
      ...(params.expectedArguments
        ? { expectedShape: { arguments: params.expectedArguments } }
        : {}),
    },
  };
}

function normalizeDependencyRefs(value: unknown): {
  values: string[];
  error?: string;
} {
  if (value === undefined) {
    return { values: [] };
  }

  if (!Array.isArray(value)) {
    return {
      values: [],
      error: 'dependsOnWorkstreams must be an array of completed workstream ids.',
    };
  }

  const values = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
  return { values };
}

function hasUserConstraintStateConflict(goal: AgentGoal): boolean {
  if (goal.userConstraintIntegrity === 'conflict') return true;
  const stored = (goal as AgentGoal & { userConstraints?: unknown }).userConstraints;
  return (
    stored !== undefined &&
    (!isBlockingGoal(goal) || !arePersistedAgentGoalUserConstraintsCanonical(stored))
  );
}

export function resolveDelegatedWorkerSpawnPlan(params: {
  request: DelegatedWorkerSpawnRequest;
  conversation: Conversation | undefined;
  parentConversationId?: string;
  agentRunId: string | undefined;
  liveWorkers: SubAgentSnapshot[];
  parentGoals?: ReadonlyArray<AgentGoal>;
  /** The worker session asking to spawn, when a worker is the caller. */
  callerSessionId?: string;
}): DelegatedWorkerSpawnPlan {
  const activeRun = resolveDelegatedWorkerActiveRun(params.conversation, params.agentRunId);
  const dependencyRefs = normalizeDependencyRefs(params.request.dependsOnWorkstreams);
  if (dependencyRefs.error) {
    return {
      status: 'error',
      goals: [],
      spawnGate: { status: 'blocked', error: dependencyRefs.error },
      response: buildRepairableSpawnArgumentError({
        code: 'invalid_argument_shape',
        error: dependencyRefs.error,
        invalidFields: ['dependsOnWorkstreams'],
        expectedArguments: { dependsOnWorkstreams: { type: 'array', items: { type: 'string' } } },
      }),
    };
  }

  const goals = [...(params.parentGoals ?? activeRun?.controlGraph?.goals ?? [])];
  const currentRunId = activeRun?.id ?? params.agentRunId?.trim();
  const workstreamResolution = resolveSpawnWorkstream({
    workstreamId: params.request.workstreamId,
    goals,
  });
  if (workstreamResolution.status === 'error') {
    const error = workstreamResolution.error;
    return {
      status: 'error',
      goals,
      spawnGate: { status: 'blocked', error },
      response: buildRepairableSpawnArgumentError({
        code: 'invalid_workstream',
        error,
        invalidFields: ['workstreamId'],
        expectedArguments: { workstreamId: { type: 'string' } },
      }),
    };
  }

  const explicitWorkstreamId = workstreamResolution.workstreamId;
  const eligibleDedicatedGoals = goals.filter(isIncompleteDedicatedWorkerGoal);
  if (!explicitWorkstreamId && eligibleDedicatedGoals.length > 1) {
    const eligibleGoalIds = eligibleDedicatedGoals.map((goal) => goal.id);
    const error = 'Several workstreams are open; select one exact workstreamId.';
    return {
      status: 'error',
      goals,
      spawnGate: { status: 'blocked', error },
      response: {
        ...buildRepairableSpawnArgumentError({
          code: 'workstream_id_required',
          error,
          invalidFields: ['workstreamId'],
          expectedArguments: { workstreamId: { type: 'string', enum: eligibleGoalIds } },
        }),
        eligibleGoalIds,
      },
    };
  }
  const workstreamId =
    explicitWorkstreamId ||
    (eligibleDedicatedGoals.length === 1 ? eligibleDedicatedGoals[0].id : undefined);
  const scopedGoals = workstreamId ? goals.filter((goal) => goal.id === workstreamId) : [];
  const completedScopedGoal = scopedGoals.find((goal) => goal.status === 'completed');
  if (completedScopedGoal) {
    const error = `Workstream "${completedScopedGoal.id}" is already complete; omit workstreamId to start new work.`;
    return {
      status: 'error',
      goals,
      spawnGate: { status: 'blocked', workstreamId, error },
      response: buildRepairableSpawnArgumentError({
        code: 'invalid_workstream',
        error,
        invalidFields: ['workstreamId'],
      }),
    };
  }
  const conflictedScopedGoal = scopedGoals.find(hasUserConstraintStateConflict);
  if (conflictedScopedGoal) {
    const error = `Goal "${conflictedScopedGoal.id}" has conflicted user constraint state.`;
    return {
      status: 'blocked',
      goals,
      spawnGate: { status: 'blocked', workstreamId, error },
      response: {
        status: 'blocked',
        code: 'user_constraint_state_conflict',
        error,
      },
    };
  }

  const durableLaunchOwner = scopedGoals
    .flatMap((goal) =>
      goal.evidence.map((evidence) => ({
        goal,
        sessionId: readDelegatedWorkerLaunchSessionId(evidence),
      })),
    )
    .find((entry) => entry.sessionId);
  if (durableLaunchOwner?.sessionId) {
    return {
      status: 'blocked',
      goals,
      spawnGate: { status: 'blocked', workstreamId },
      response: {
        status: 'blocked',
        code: 'worker_workstream_already_owned',
        error: 'A worker already owns this workstream in the current run.',
        sessionId: durableLaunchOwner.sessionId,
        goalId: durableLaunchOwner.goal.id,
        guidance:
          'Inspect the existing terminal result. Continue that exact session for one recoverable gap, or report its blocker; do not launch a replacement worker for the same work.',
      },
    };
  }

  const missingDependencies = dependencyRefs.values.filter(
    (dependencyId) => !goals.some((candidate) => candidate.id === dependencyId),
  );
  if (missingDependencies.length > 0) {
    const error = `Unknown dependency workstream id(s): ${missingDependencies.join(', ')}`;
    return {
      status: 'error',
      goals,
      spawnGate: { status: 'blocked', workstreamId, error },
      response: {
        ...buildRepairableSpawnArgumentError({
          code: 'unresolved_dependency',
          error,
          invalidFields: ['dependsOnWorkstreams'],
          expectedArguments: {
            dependsOnWorkstreams: { type: 'array', items: { type: 'string' } },
          },
        }),
        dependsOnWorkstreams: missingDependencies,
      },
    };
  }

  const incompleteDependencies = dependencyRefs.values.filter((dependencyId) => {
    const goal = goals.find((candidate) => candidate.id === dependencyId);
    return goal?.status !== 'completed';
  });
  if (incompleteDependencies.length > 0) {
    return {
      status: 'blocked',
      goals,
      spawnGate: {
        status: 'blocked',
        workstreamId,
        error: `Dependencies are not completed: ${incompleteDependencies.join(', ')}`,
      },
      response: {
        status: 'blocked',
        error: `Dependencies are not completed: ${incompleteDependencies.join(', ')}`,
        dependsOnWorkstreams: incompleteDependencies,
      },
    };
  }

  const duplicateRunning = params.liveWorkers.find(
    (worker) =>
      worker.status === 'running' &&
      (worker.workstreamId === workstreamId || worker.name === params.request.name?.trim()),
  );
  if (duplicateRunning && duplicateRunning.sessionId === params.callerSessionId) {
    // The running worker for this goal is the caller. Answered as a duplicate, with its
    // own session id, a worker took that id as another worker to wait for and waited on
    // itself until the supervisor's turn timed out (live, delegation-worker-finalize).
    return {
      status: 'blocked',
      goals,
      spawnGate: { status: 'blocked', workstreamId },
      response: {
        status: 'blocked',
        code: 'caller_owns_workstream',
        error: 'You are the worker running this workstream, so it cannot be delegated again.',
        sessionId: duplicateRunning.sessionId,
        guidance:
          'Do the assigned task yourself and give its result as your final answer. Do not ' +
          'wait on this session: it is your own.',
      },
    };
  }
  if (duplicateRunning) {
    return {
      status: 'blocked',
      goals,
      spawnGate: { status: 'blocked', workstreamId },
      response: {
        status: 'blocked',
        error: 'A worker for this workstream is already running.',
        sessionId: duplicateRunning.sessionId,
      },
    };
  }

  const normalizedName = params.request.name?.trim();
  const priorWorkstreamOwner = currentRunId
    ? params.liveWorkers.find((worker) => {
        if (worker.status === 'running' || worker.agentRunId !== currentRunId) return false;
        if (workstreamId && worker.workstreamId) return worker.workstreamId === workstreamId;
        return (
          !workstreamId &&
          !worker.workstreamId &&
          Boolean(normalizedName) &&
          worker.name === normalizedName
        );
      })
    : undefined;
  if (priorWorkstreamOwner) {
    return {
      status: 'blocked',
      goals,
      spawnGate: { status: 'blocked', workstreamId },
      response: {
        status: 'blocked',
        code: 'worker_workstream_already_owned',
        error: 'A worker already owns this workstream in the current run.',
        sessionId: priorWorkstreamOwner.sessionId,
        workerStatus: priorWorkstreamOwner.status,
        guidance:
          'Inspect the existing result. If one recoverable gap remains, continue that session with sessions_send; otherwise report its blocker or use a different structured workstream.',
      },
    };
  }

  const priorNamedOwner =
    currentRunId && normalizedName
      ? params.liveWorkers.find(
          (worker) =>
            worker.status !== 'running' &&
            worker.agentRunId === currentRunId &&
            worker.name?.trim() === normalizedName,
        )
      : undefined;
  if (priorNamedOwner) {
    return {
      status: 'blocked',
      goals,
      spawnGate: { status: 'blocked', workstreamId },
      response: {
        status: 'blocked',
        code: 'worker_identity_already_owned',
        error: 'A worker with this name already exists in the current run.',
        sessionId: priorNamedOwner.sessionId,
        workerStatus: priorNamedOwner.status,
        guidance:
          'Inspect and reconcile the existing worker result. Continue that session for one recoverable gap, or use a distinct worker name only for genuinely different delegated work.',
      },
    };
  }

  const spawnPreflight = evaluateMobileSpawnPreflight({
    depth: params.request.depth ?? 0,
    parentConversationId:
      params.parentConversationId?.trim() || params.conversation?.id?.trim() || '',
    agentRunId: activeRun?.id ?? params.agentRunId,
    liveWorkers: params.liveWorkers,
  });
  if (spawnPreflight.status === 'blocked') {
    return {
      status: 'blocked',
      goals,
      spawnGate: { status: 'blocked', workstreamId },
      response: {
        status: 'blocked',
        error: spawnPreflight.error,
        ...(spawnPreflight.sessionId ? { sessionId: spawnPreflight.sessionId } : {}),
        ...(spawnPreflight.code ? { code: spawnPreflight.code } : {}),
      },
    };
  }

  return {
    status: 'ready',
    activeRun,
    goals,
    spawnGate: {
      status: 'ready',
      workstreamId,
    },
  };
}
