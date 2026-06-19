import type { AgentRunPlan } from '../../../types/agentRun';
import type { SubAgentSnapshot } from '../../../types/subAgent';
import {
  normalizeWorkflowDependencyReference,
  normalizeWorkflowWorkstreams,
  resolveWorkflowWorkstreamReference,
} from '../workflowSchedulingReferences';
import { createWorkflowExecutionState, getWorkflowExecutionStates } from './workflowExecutionState';
import type {
  WorkflowBlockingDependency,
  WorkflowContinuationWorkstreamState,
  WorkflowExecutionState,
  WorkflowPlanContinuationResult,
  WorkflowSpawnGateResult,
} from '../workflowSchedulingTypes';

export function evaluateWorkflowSpawnGate(params: {
  plan?: Pick<AgentRunPlan, 'workstreams'>;
  workers: ReadonlyArray<
    Pick<SubAgentSnapshot, 'workstreamId' | 'sessionId' | 'status' | 'output'>
  >;
  workstreamId?: string;
  dependsOnWorkstreams?: string[];
  completedWorkstreamIds?: string[];
}): WorkflowSpawnGateResult {
  const normalizedWorkstreams = normalizeWorkflowWorkstreams(params.plan?.workstreams);
  const executionStates = getWorkflowExecutionStates(
    normalizedWorkstreams,
    params.workers,
    params.completedWorkstreamIds,
  );
  const effectiveWorkstreamId = params.workstreamId?.trim() || undefined;
  const plannedWorkstream = effectiveWorkstreamId
    ? normalizedWorkstreams.find((workstream) => workstream.id === effectiveWorkstreamId)
    : undefined;

  const dependencyIds = Array.from(
    new Set(
      [
        ...(plannedWorkstream?.dependencies ?? []),
        ...(params.dependsOnWorkstreams ?? [])
          .map((dependency) => {
            const normalizedDependency = normalizeWorkflowDependencyReference(dependency);
            if (!normalizedDependency) {
              return undefined;
            }

            return (
              resolveWorkflowWorkstreamReference(normalizedWorkstreams, normalizedDependency) ??
              normalizedDependency
            );
          })
          .filter((dependency): dependency is string => Boolean(dependency)),
      ].filter((dependencyId) => dependencyId !== effectiveWorkstreamId),
    ),
  );

  const duplicateRunningSessionIds = effectiveWorkstreamId
    ? (executionStates[effectiveWorkstreamId]?.runningSessionIds ?? [])
    : [];
  const duplicateCompletedSessionIds = effectiveWorkstreamId
    ? (executionStates[effectiveWorkstreamId]?.completedSessionIds ?? [])
    : [];
  const duplicateCompletedWorkstreamIds =
    effectiveWorkstreamId && executionStates[effectiveWorkstreamId]?.completedByGraph
      ? [effectiveWorkstreamId]
      : [];

  const blockingDependencies = dependencyIds.reduce<WorkflowBlockingDependency[]>(
    (accumulator, dependencyId) => {
      const state = executionStates[dependencyId] ?? createWorkflowExecutionState(dependencyId);

      if (state.completedByGraph || state.completedSessionIds.length > 0) {
        return accumulator;
      }

      accumulator.push({
        workstreamId: dependencyId,
        title: state.title,
        status: state.status,
        sessionIds:
          state.runningSessionIds.length > 0
            ? [...state.runningSessionIds]
            : [...state.failedSessionIds],
      });
      return accumulator;
    },
    [],
  );

  return {
    status:
      duplicateRunningSessionIds.length > 0 ||
      duplicateCompletedSessionIds.length > 0 ||
      duplicateCompletedWorkstreamIds.length > 0 ||
      blockingDependencies.length > 0
        ? 'blocked'
        : 'ready',
    ...(effectiveWorkstreamId ? { workstreamId: effectiveWorkstreamId } : {}),
    dependencyIds,
    unmetDependencyIds: blockingDependencies.map((dependency) => dependency.workstreamId),
    duplicateRunningSessionIds,
    duplicateCompletedSessionIds,
    duplicateCompletedWorkstreamIds,
    blockingDependencies,
  };
}

function buildWorkflowPlanContinuationSummary(params: {
  totalWorkstreams: number;
  runningWorkstreams: WorkflowContinuationWorkstreamState[];
  readyWorkstreams: WorkflowContinuationWorkstreamState[];
  blockedWorkstreams: WorkflowContinuationWorkstreamState[];
}): string {
  if (params.totalWorkstreams <= 0) {
    return 'No structured workstreams remain. Ready for Pilot review.';
  }

  const remainingCount =
    params.runningWorkstreams.length +
    params.readyWorkstreams.length +
    params.blockedWorkstreams.length;
  if (remainingCount <= 0) {
    return params.totalWorkstreams === 1
      ? 'The only structured workstream is complete. Ready for Pilot review.'
      : `All ${params.totalWorkstreams} structured workstreams are complete. Ready for Pilot review.`;
  }

  const readyFailedCount = params.readyWorkstreams.filter(
    (workstream) => workstream.status === 'failed',
  ).length;
  const readyFreshCount = params.readyWorkstreams.length - readyFailedCount;
  const statusParts: string[] = [];

  if (params.runningWorkstreams.length > 0) {
    statusParts.push(`${params.runningWorkstreams.length} running`);
  }
  if (readyFreshCount > 0) {
    statusParts.push(`${readyFreshCount} ready`);
  }
  if (readyFailedCount > 0) {
    statusParts.push(`${readyFailedCount} failed and ready for repair`);
  }
  if (params.blockedWorkstreams.length > 0) {
    statusParts.push(`${params.blockedWorkstreams.length} blocked`);
  }

  const statusSummary = statusParts.length > 0 ? ` (${statusParts.join(', ')})` : '';

  return `Structured plan still has remaining work${statusSummary}. Continue the existing run instead of handing off to Pilot yet.`;
}

export function evaluateWorkflowPlanContinuation(params: {
  plan?: Pick<AgentRunPlan, 'workstreams'>;
  workers: ReadonlyArray<
    Pick<SubAgentSnapshot, 'workstreamId' | 'sessionId' | 'status' | 'output'>
  >;
  completedWorkstreamIds?: string[];
}): WorkflowPlanContinuationResult {
  const normalizedWorkstreams = normalizeWorkflowWorkstreams(params.plan?.workstreams);
  if (normalizedWorkstreams.length <= 0) {
    return {
      status: 'ready-for-pilot',
      hasStructuredPlan: false,
      totalWorkstreams: 0,
      completedWorkstreams: [],
      runningWorkstreams: [],
      readyWorkstreams: [],
      blockedWorkstreams: [],
      summary: 'No structured workstreams remain. Ready for Pilot review.',
    };
  }

  const executionStates = getWorkflowExecutionStates(
    normalizedWorkstreams,
    params.workers,
    params.completedWorkstreamIds,
  );
  const completedWorkstreams: WorkflowExecutionState[] = [];
  const runningWorkstreams: WorkflowContinuationWorkstreamState[] = [];
  const readyWorkstreams: WorkflowContinuationWorkstreamState[] = [];
  const blockedWorkstreams: WorkflowContinuationWorkstreamState[] = [];

  for (const workstream of normalizedWorkstreams) {
    const executionState =
      executionStates[workstream.id] ??
      createWorkflowExecutionState(workstream.id, workstream.title);

    if (executionState.completedByGraph || executionState.status === 'completed') {
      completedWorkstreams.push(executionState);
      continue;
    }

    const dependencyIds = [...(workstream.dependencies ?? [])];
    const unmetDependencyIds = dependencyIds.filter((dependencyId) => {
      const dependencyState = executionStates[dependencyId];
      return (
        !dependencyState?.completedByGraph &&
        (dependencyState?.completedSessionIds.length ?? 0) <= 0
      );
    });

    const continuationState: WorkflowContinuationWorkstreamState = {
      ...executionState,
      title: workstream.title,
      dependencyIds,
      unmetDependencyIds,
    };

    if (executionState.status === 'running') {
      runningWorkstreams.push(continuationState);
      continue;
    }

    if (unmetDependencyIds.length > 0) {
      blockedWorkstreams.push(continuationState);
      continue;
    }

    readyWorkstreams.push(continuationState);
  }

  const summary = buildWorkflowPlanContinuationSummary({
    totalWorkstreams: normalizedWorkstreams.length,
    runningWorkstreams,
    readyWorkstreams,
    blockedWorkstreams,
  });

  return {
    status:
      runningWorkstreams.length > 0 || readyWorkstreams.length > 0 || blockedWorkstreams.length > 0
        ? 'continue'
        : 'ready-for-pilot',
    hasStructuredPlan: true,
    totalWorkstreams: normalizedWorkstreams.length,
    completedWorkstreams,
    runningWorkstreams,
    readyWorkstreams,
    blockedWorkstreams,
    summary,
  };
}
