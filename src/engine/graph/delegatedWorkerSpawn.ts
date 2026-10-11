import type { AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import type { SubAgentSnapshot } from '../../types/subAgent';
import {
  evaluateMobileSpawnPreflight,
  resolveSpawnWorkstream,
} from '../../services/agents/mobileSpawnPolicy';

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
  spawnGate: DelegatedWorkerSpawnGate;
  response?: Record<string, unknown>;
}

const WORKSTREAM_ID_BASE = 'delegated-workstream';

/** A new workstream's id: unique among the workstreams this run's workers already hold. */
function mintWorkstreamId(
  runWorkers: ReadonlyArray<Pick<SubAgentSnapshot, 'workstreamId'>>,
): string {
  const held = new Set(runWorkers.map((worker) => worker.workstreamId).filter(Boolean));
  if (!held.has(WORKSTREAM_ID_BASE)) return WORKSTREAM_ID_BASE;
  let ordinal = 2;
  while (held.has(`${WORKSTREAM_ID_BASE}-${ordinal}`)) ordinal += 1;
  return `${WORKSTREAM_ID_BASE}-${ordinal}`;
}

/** A worker that delivered its answer, so work depending on it can start. */
function hasDelivered(worker: Pick<SubAgentSnapshot, 'status' | 'completionState'>): boolean {
  return worker.status === 'completed' && worker.completionState === 'verified_success';
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

export function resolveDelegatedWorkerSpawnPlan(params: {
  request: DelegatedWorkerSpawnRequest;
  conversation: Conversation | undefined;
  parentConversationId?: string;
  agentRunId: string | undefined;
  liveWorkers: SubAgentSnapshot[];
  /** The worker session asking to spawn, when a worker is the caller. */
  callerSessionId?: string;
}): DelegatedWorkerSpawnPlan {
  const activeRun = resolveDelegatedWorkerActiveRun(params.conversation, params.agentRunId);
  const dependencyRefs = normalizeDependencyRefs(params.request.dependsOnWorkstreams);
  if (dependencyRefs.error) {
    return {
      status: 'error',
      spawnGate: { status: 'blocked', error: dependencyRefs.error },
      response: buildRepairableSpawnArgumentError({
        code: 'invalid_argument_shape',
        error: dependencyRefs.error,
        invalidFields: ['dependsOnWorkstreams'],
        expectedArguments: { dependsOnWorkstreams: { type: 'array', items: { type: 'string' } } },
      }),
    };
  }

  const currentRunId = activeRun?.id ?? params.agentRunId?.trim();
  const runWorkers = currentRunId
    ? params.liveWorkers.filter((worker) => worker.agentRunId === currentRunId)
    : [];
  const workstreamResolution = resolveSpawnWorkstream({
    workstreamId: params.request.workstreamId,
  });
  if (workstreamResolution.status === 'error') {
    const error = workstreamResolution.error;
    return {
      status: 'error',
      spawnGate: { status: 'blocked', error },
      response: buildRepairableSpawnArgumentError({
        code: 'invalid_workstream',
        error,
        invalidFields: ['workstreamId'],
        expectedArguments: { workstreamId: { type: 'string' } },
      }),
    };
  }
  const workstreamId = workstreamResolution.workstreamId ?? mintWorkstreamId(runWorkers);

  const missingDependencies = dependencyRefs.values.filter(
    (dependencyId) => !runWorkers.some((worker) => worker.workstreamId === dependencyId),
  );
  if (missingDependencies.length > 0) {
    const error = `Unknown dependency workstream id(s): ${missingDependencies.join(', ')}`;
    return {
      status: 'error',
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

  const incompleteDependencies = dependencyRefs.values.filter(
    (dependencyId) =>
      !runWorkers.some((worker) => worker.workstreamId === dependencyId && hasDelivered(worker)),
  );
  if (incompleteDependencies.length > 0) {
    return {
      status: 'blocked',
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
    spawnGate: {
      status: 'ready',
      workstreamId,
    },
  };
}
