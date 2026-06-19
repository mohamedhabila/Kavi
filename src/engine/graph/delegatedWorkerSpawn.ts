import type { AgentGoal, AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import type { SubAgentSnapshot } from '../../types/subAgent';
import {
  evaluateMobileSpawnPreflight,
  resolveSpawnGoalScope,
} from '../../services/agents/mobileSpawnPolicy';
import { getActiveGoal } from '../goals/types';

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
  const workstreamId =
    goalScopeResolution.workstreamId ||
    normalizeOptionalWorkstreamId(params.request.workstreamId) ||
    activeGoal?.id ||
    goals.find((goal) => goal.status === 'pending')?.id;

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
