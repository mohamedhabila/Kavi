import type { AgentGoal } from '../../types/agentRun';
import type { SubAgentSnapshot } from '../../types/subAgent';
import { isExactDurableScopeId } from '../../utils/durableScopeIdentity';

/** Mobile-bounded spawn limits (single concurrent child, shallow nesting). */
export const MAX_SPAWN_DEPTH = 2;
export const MAX_CONCURRENT_SUB_AGENTS = 1;

export type MobileSpawnBlockCode = 'max_depth' | 'max_concurrent' | 'invalid_identity';

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

type SpawnWorkstreamResolution =
  | { status: 'ready'; workstreamId?: string }
  | { status: 'error'; error: string };

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

/**
 * Reads the workstream a spawn names. A workstream is the record the run opened for one
 * delegated piece of work; its id is reported back by `sessions_spawn`, so naming it again
 * addresses the same work, and omitting it starts new work.
 */
export function resolveSpawnWorkstream(request: {
  workstreamId?: unknown;
  goals: ReadonlyArray<AgentGoal>;
}): SpawnWorkstreamResolution {
  if (request.workstreamId === undefined) return { status: 'ready' };
  if (!isExactDurableScopeId(request.workstreamId)) {
    return {
      status: 'error',
      error: 'workstreamId must be the exact id a sessions_spawn result reported.',
    };
  }
  const workstreamId = request.workstreamId;
  if (request.goals.length > 0 && !request.goals.some((goal) => goal.id === workstreamId)) {
    return {
      status: 'error',
      error: `Unknown workstreamId "${workstreamId}"; omit it to start new work.`,
    };
  }
  return { status: 'ready', workstreamId };
}
