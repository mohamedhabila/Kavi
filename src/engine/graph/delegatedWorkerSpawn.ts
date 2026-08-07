import type { AgentGoal, AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import type { SubAgentSnapshot } from '../../types/subAgent';
import {
  evaluateMobileSpawnPreflight,
  resolveSpawnGoalScope,
} from '../../services/agents/mobileSpawnPolicy';
import { getActiveGoal, isBlockingGoal } from '../goals/types';
import { arePersistedAgentGoalUserConstraintsCanonical } from '../goals/userConstraints';
import {
  DELEGATED_WORKER_EVIDENCE_CRITERION,
  DELEGATED_WORKER_GOAL_OWNER,
  isDelegationOwnedGoal,
  DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
  readDelegatedWorkerLaunchSessionId,
} from '../goals/delegation';

export interface DelegatedWorkerSpawnGoalScope {
  goalIds?: string[];
}

export interface DelegatedWorkerSpawnRequest {
  prompt: string;
  name?: string;
  workstreamId?: string;
  dependsOnWorkstreams?: string[];
  goalScope?: DelegatedWorkerSpawnGoalScope;
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

function requiresWorkerCompletionEvidence(goal: AgentGoal): boolean {
  return isBlockingGoal(goal) && hasCoordinateCapability(goal);
}

function hasWorkerCompletionEvidenceCriterion(goal: AgentGoal): boolean {
  return (goal.successCriteria ?? []).some(
    (criterion) => criterion.trim() === DELEGATED_WORKER_EVIDENCE_CRITERION,
  );
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
    return { values: [], error: 'dependsOnWorkstreams must be an array of completed goal ids.' };
  }

  const values = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
  return { values };
}

function normalizeOptionalWorkstreamId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
  const hasStructuredGoalGraph =
    params.parentGoals !== undefined || activeRun?.controlGraph !== undefined;
  const goalScopeResolution = resolveSpawnGoalScope({
    goalIds: params.request.goalScope?.goalIds,
    workstreamId: params.request.workstreamId,
    goals,
  });
  if (goalScopeResolution.status === 'error') {
    const error = goalScopeResolution.error ?? 'Invalid goal scope.';
    return {
      status: 'error',
      goals,
      spawnGate: { status: 'blocked', error },
      response: buildRepairableSpawnArgumentError({
        code: 'invalid_goal_scope',
        error,
        invalidFields: ['goalScope', 'workstreamId'],
        expectedArguments: {
          workstreamId: { type: 'string' },
          goalScope: {
            type: 'object',
            properties: { goalIds: { type: 'array', items: { type: 'string' } } },
          },
        },
      }),
    };
  }

  const activeGoal = getActiveGoal(goals);
  const explicitWorkstreamId =
    goalScopeResolution.workstreamId || normalizeOptionalWorkstreamId(params.request.workstreamId);
  const eligibleDedicatedGoals = goals.filter(isIncompleteDedicatedWorkerGoal);
  if (!explicitWorkstreamId && eligibleDedicatedGoals.length > 1) {
    const eligibleGoalIds = eligibleDedicatedGoals.map((goal) => goal.id);
    const error = 'Multiple delegated-worker goals are eligible; select one exact workstreamId.';
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
        guidance:
          'Retry sessions_spawn with one existing eligible goal id. Do not add or replace a delegated goal.',
      },
    };
  }
  const workstreamId =
    explicitWorkstreamId ||
    (eligibleDedicatedGoals.length === 1 ? eligibleDedicatedGoals[0].id : undefined) ||
    activeGoal?.id ||
    goals.find((goal) => goal.status === 'pending')?.id;
  const scopedGoals = Array.from(
    new Map(
      [
        ...(goalScopeResolution.scopedGoals ?? []),
        ...(workstreamId ? goals.filter((goal) => goal.id === workstreamId) : []),
      ].map((goal) => [goal.id, goal]),
    ).values(),
  );
  const completedScopedGoal = scopedGoals.find((goal) => goal.status === 'completed');
  if (completedScopedGoal) {
    const error = `Completed goal "${completedScopedGoal.id}" cannot be selected for delegated work.`;
    return {
      status: 'error',
      goals,
      spawnGate: { status: 'blocked', workstreamId, error },
      response: buildRepairableSpawnArgumentError({
        code: 'invalid_goal_scope',
        error,
        invalidFields: ['goalScope', 'workstreamId'],
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

  const nonDedicatedDelegationGoal = scopedGoals.find(
    (goal) =>
      isBlockingGoal(goal) &&
      (!isDelegationOwnedGoal(goal) || !hasCoordinateCapability(goal)),
  );
  if (hasStructuredGoalGraph && nonDedicatedDelegationGoal) {
    const error = `Goal "${nonDedicatedDelegationGoal.id}" is not a dedicated delegated-worker goal.`;
    const eligibleGoalIds = eligibleDedicatedGoals.map((goal) => goal.id);
    const hasExistingEligibleGoal = eligibleGoalIds.length > 0;
    return {
      status: 'blocked',
      goals,
      spawnGate: { status: 'blocked', workstreamId, error },
      response: {
        status: 'blocked',
        code: 'dedicated_worker_goal_required',
        error,
        guidance: hasExistingEligibleGoal
          ? `Retry sessions_spawn with the existing delegated-worker goal id ${JSON.stringify(eligibleGoalIds[0])}. Do not add or replace a delegated goal.`
          : 'Add a separate blocking goal for this worker; do not repurpose the parent deliverable goal. Set owner:"delegated-worker", include requiredCapabilities:"coordinate", and use evidence.prefix:worker plus evidence.min:1. Then retry sessions_spawn with that new goal id as workstreamId.',
        repair: {
          retryable: true,
          requiredAction: hasExistingEligibleGoal ? 'sessions_spawn' : 'update_goals',
          invalidGoalId: nonDedicatedDelegationGoal.id,
          expectedShape: hasExistingEligibleGoal
            ? { arguments: { workstreamId: eligibleGoalIds[0] } }
            : {
                arguments: {
                  action: 'add',
                  id: 'delegated-workstream',
                  name: 'Delegated workstream',
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
              },
        },
      },
    };
  }

  const invalidDelegationGoal = scopedGoals.find(
    (goal) => requiresWorkerCompletionEvidence(goal) && !hasWorkerCompletionEvidenceCriterion(goal),
  );
  if (hasStructuredGoalGraph && invalidDelegationGoal) {
    const error = `Goal "${invalidDelegationGoal.id}" cannot verify a terminal worker result.`;
    return {
      status: 'blocked',
      goals,
      spawnGate: { status: 'blocked', workstreamId, error },
      response: {
        status: 'blocked',
        code: 'worker_evidence_contract_required',
        error,
        guidance:
          'Update the delegated goal before spawning. Use evidence.prefix:worker for the terminal worker result and evidence.min:1 for one worker. evidence.min counts graph evidence records, not items inside the worker report. Keep separate parent deliverable criteria on separate goals.',
        repair: {
          retryable: true,
          requiredAction: 'update_goals',
          expectedShape: {
            arguments: {
              action: 'update',
              id: invalidDelegationGoal.id,
              name: invalidDelegationGoal.title,
              successCriteria: [
                DELEGATED_WORKER_EVIDENCE_CRITERION,
                DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
              ],
            },
          },
        },
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
  if (hasStructuredGoalGraph && durableLaunchOwner?.sessionId) {
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
          'Inspect the existing terminal result. Continue that exact session for one recoverable gap, or report its blocker; do not launch a replacement worker for the same goal.',
      },
    };
  }

  const missingDependencies = dependencyRefs.values.filter(
    (dependencyId) => !goals.some((candidate) => candidate.id === dependencyId),
  );
  if (missingDependencies.length > 0) {
    const error = `Unknown dependency goal id(s): ${missingDependencies.join(', ')}`;
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

  const hasIncompleteGoal = goals.some(
    (goal) => goal.status === 'active' || goal.status === 'pending' || goal.status === 'blocked',
  );
  if (hasStructuredGoalGraph && !hasIncompleteGoal) {
    const error = 'Delegated work requires an incomplete structured goal in the current run.';
    return {
      status: 'blocked',
      goals,
      spawnGate: { status: 'blocked', error },
      response: {
        status: 'blocked',
        code: 'goal_scope_required',
        error,
        guidance:
          'Call update_goals in a separate turn to create an incomplete blocking goal that retains the current user constraint, then retry this worker spawn against that goal.',
        repair: {
          retryable: true,
          requiredAction: 'update_goals',
        },
      },
    };
  }

  const duplicateRunning = params.liveWorkers.find(
    (worker) =>
      worker.status === 'running' &&
      (worker.workstreamId === workstreamId || worker.name === params.request.name?.trim()),
  );
  if (duplicateRunning) {
    return {
      status: 'blocked',
      goals,
      spawnGate: { status: 'blocked', workstreamId },
      response: {
        status: 'blocked',
        error: 'A worker for this goal is already running.',
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
