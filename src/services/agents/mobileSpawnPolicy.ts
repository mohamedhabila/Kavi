import type { AgentGoal } from '../../types/agentRun';
import type { SubAgentSnapshot } from '../../types/subAgent';
import { isExactDurableScopeId } from '../../utils/durableScopeIdentity';

/** Mobile-bounded spawn limits (single concurrent child, shallow nesting). */
export const MAX_SPAWN_DEPTH = 2;
export const MAX_CONCURRENT_SUB_AGENTS = 1;

export type MobileSpawnBlockCode =
  | 'max_depth'
  | 'max_concurrent'
  | 'invalid_goal_scope'
  | 'invalid_identity';

export interface MobileSpawnPreflightRequest {
  depth: number;
  parentConversationId: string;
  agentRunId?: string;
  liveWorkers: ReadonlyArray<
    Pick<SubAgentSnapshot, 'parentConversationId' | 'agentRunId' | 'status' | 'sessionId'>
  >;
}

export interface MobileSpawnPreflightResult {
  status: 'ready' | 'blocked';
  code?: MobileSpawnBlockCode;
  error?: string;
  sessionId?: string;
}

export interface SpawnGoalScopeRequest {
  goalIds?: unknown;
  workstreamId?: unknown;
  goals: ReadonlyArray<AgentGoal>;
}

export interface SpawnGoalScopeResolution {
  status: 'ready' | 'error';
  workstreamId?: string;
  scopedGoals?: AgentGoal[];
  error?: string;
}

function resolveGoalIdList(goalIds: unknown): { values: string[]; error?: string } {
  if (goalIds === undefined) {
    return { values: [] };
  }
  if (!Array.isArray(goalIds) || !goalIds.every(isExactDurableScopeId)) {
    return { values: [], error: 'goalScope.goalIds must contain exact durable goal ids.' };
  }
  if (new Set(goalIds).size !== goalIds.length) {
    return { values: [], error: 'goalScope.goalIds must not contain duplicate goal ids.' };
  }
  return { values: goalIds };
}

export function evaluateMobileSpawnPreflight(
  request: MobileSpawnPreflightRequest,
): MobileSpawnPreflightResult {
  if (request.depth >= MAX_SPAWN_DEPTH) {
    return {
      status: 'blocked',
      code: 'max_depth',
      error: `Maximum sub-agent spawn depth (${MAX_SPAWN_DEPTH}) exceeded.`,
    };
  }

  if (
    !isExactDurableScopeId(request.parentConversationId) ||
    (request.agentRunId !== undefined && !isExactDurableScopeId(request.agentRunId))
  ) {
    return {
      status: 'blocked',
      code: 'invalid_identity',
      error: 'Worker spawn scope contains a malformed durable identity.',
    };
  }
  const invalidRunningWorker = request.liveWorkers.find(
    (worker) =>
      worker.status === 'running' &&
      (!isExactDurableScopeId(worker.sessionId) ||
        !isExactDurableScopeId(worker.parentConversationId) ||
        (worker.agentRunId !== undefined && !isExactDurableScopeId(worker.agentRunId))),
  );
  if (invalidRunningWorker) {
    return {
      status: 'blocked',
      code: 'invalid_identity',
      error: 'A running worker has malformed durable ownership state.',
      sessionId: isExactDurableScopeId(invalidRunningWorker.sessionId)
        ? invalidRunningWorker.sessionId
        : undefined,
    };
  }

  const parentConversationId = request.parentConversationId;
  const agentRunId = request.agentRunId;
  const runningWorkers = request.liveWorkers.filter((worker) => {
    if (worker.status !== 'running') {
      return false;
    }
    if (worker.parentConversationId !== parentConversationId) {
      return false;
    }
    if (agentRunId && worker.agentRunId !== agentRunId) {
      return false;
    }
    return true;
  });

  if (runningWorkers.length >= MAX_CONCURRENT_SUB_AGENTS) {
    const blockingWorker = runningWorkers[0];
    return {
      status: 'blocked',
      code: 'max_concurrent',
      error: `Only ${MAX_CONCURRENT_SUB_AGENTS} concurrent sub-agent may run per supervisor session.`,
      sessionId: blockingWorker?.sessionId,
    };
  }

  return { status: 'ready' };
}

export function resolveSpawnGoalScope(request: SpawnGoalScopeRequest): SpawnGoalScopeResolution {
  const scopedGoalIdResolution = resolveGoalIdList(request.goalIds);
  if (scopedGoalIdResolution.error) {
    return { status: 'error', error: scopedGoalIdResolution.error };
  }
  if (request.workstreamId !== undefined && !isExactDurableScopeId(request.workstreamId)) {
    return { status: 'error', error: 'workstreamId must be an exact durable goal id.' };
  }
  const scopedGoalIds = scopedGoalIdResolution.values;
  const workstreamId = request.workstreamId;

  if (scopedGoalIds.length === 0) {
    if (!workstreamId) {
      return { status: 'ready', scopedGoals: [] };
    }

    if (request.goals.length === 0) {
      return {
        status: 'ready',
        workstreamId,
        scopedGoals: [],
      };
    }

    const matchedGoal = request.goals.find((goal) => goal.id === workstreamId);
    if (!matchedGoal) {
      return {
        status: 'error',
        error: `Unknown workstreamId "${workstreamId}" for the current goal graph.`,
      };
    }

    return {
      status: 'ready',
      workstreamId,
      scopedGoals: [matchedGoal],
    };
  }

  if (request.goals.length === 0) {
    if (workstreamId && !scopedGoalIds.includes(workstreamId)) {
      return {
        status: 'error',
        error: `workstreamId "${workstreamId}" must be included in goalScope.goalIds.`,
      };
    }

    return {
      status: 'ready',
      workstreamId: workstreamId || scopedGoalIds[0],
      scopedGoals: [],
    };
  }

  const scopedGoals = scopedGoalIds
    .map((goalId) => request.goals.find((goal) => goal.id === goalId))
    .filter((goal): goal is AgentGoal => Boolean(goal));

  if (scopedGoals.length !== scopedGoalIds.length) {
    const missingGoalIds = scopedGoalIds.filter(
      (goalId) => !scopedGoals.some((goal) => goal.id === goalId),
    );
    return {
      status: 'error',
      error: `Unknown goal id(s) in goalScope: ${missingGoalIds.join(', ')}`,
    };
  }

  if (workstreamId && !scopedGoalIds.includes(workstreamId)) {
    return {
      status: 'error',
      error: `workstreamId "${workstreamId}" must be included in goalScope.goalIds.`,
    };
  }

  const resolvedWorkstreamId = workstreamId || scopedGoalIds[0];
  return {
    status: 'ready',
    workstreamId: resolvedWorkstreamId,
    scopedGoals,
  };
}
