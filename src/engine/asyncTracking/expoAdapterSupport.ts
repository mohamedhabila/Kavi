import { isPlainRecord } from './support';
import { deleteTrackedAsyncOperation, upsertTrackedAsyncOperation } from './trackerStore';
import type { AsyncOperationStatus, TrackedAsyncOperation } from './types';

function buildProjectScopedExpoResourceId(projectId: string): string {
  return `project:${projectId}`;
}

export function normalizeExpoWorkflowStatus(
  mode: string | undefined,
  status: unknown,
  conclusion: unknown,
): AsyncOperationStatus | undefined {
  if (typeof status !== 'string' || !status.trim()) {
    return undefined;
  }

  const normalizedStatus = status.trim();
  const upperStatus = normalizedStatus.toUpperCase();
  const normalizedMode = (mode || '').trim().toLowerCase();
  const normalizedConclusion =
    typeof conclusion === 'string' ? conclusion.trim().toLowerCase() : '';

  if (normalizedMode === 'github-workflow') {
    if (normalizedStatus !== 'completed') {
      return 'running';
    }
    return normalizedConclusion && normalizedConclusion !== 'success' ? 'failed' : 'completed';
  }

  if (['NEW', 'IN_PROGRESS', 'ACTION_REQUIRED'].includes(upperStatus)) {
    return 'running';
  }

  if (['SUCCESS', 'COMPLETED'].includes(upperStatus)) {
    return 'completed';
  }

  return 'failed';
}

function buildExpoTrackedOperation(params: {
  toolName: string;
  projectId: string;
  projectName?: string;
  workflowRunId?: string;
  mode?: string;
  status: AsyncOperationStatus;
}): Omit<TrackedAsyncOperation, 'key' | 'updatedAt'> {
  const resourceId = params.workflowRunId || buildProjectScopedExpoResourceId(params.projectId);
  const monitorToolNames = params.workflowRunId
    ? ['expo_eas_workflow_status', 'expo_eas_workflow_wait']
    : ['expo_eas_workflow_runs', 'expo_eas_workflow_status', 'expo_eas_workflow_wait'];

  return {
    kind: 'expo-workflow',
    resourceId,
    displayName: params.workflowRunId
      ? `Expo workflow ${params.workflowRunId}`
      : `Expo workflow for ${params.projectName || params.projectId}`,
    status: params.status,
    lastUpdatedByTool: params.toolName,
    monitorToolNames,
    statusArgs: params.workflowRunId
      ? { projectId: params.projectId, workflowRunId: params.workflowRunId }
      : { projectId: params.projectId },
    waitToolName: 'expo_eas_workflow_wait',
    waitArgs: params.workflowRunId
      ? { projectId: params.projectId, workflowRunId: params.workflowRunId }
      : { projectId: params.projectId },
  };
}

export function upsertTrackedExpoWorkflow(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  params: {
    toolName: string;
    projectId: string;
    projectName?: string;
    workflowRunId?: string;
    mode?: string;
    status: AsyncOperationStatus;
  },
  options?: { onlyUpdateExisting?: boolean },
): void {
  if (params.workflowRunId) {
    deleteTrackedAsyncOperation(
      trackedOperations,
      'expo-workflow',
      buildProjectScopedExpoResourceId(params.projectId),
    );
  }

  upsertTrackedAsyncOperation(trackedOperations, buildExpoTrackedOperation(params), options);
}

function parseExpoRunTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function parseExpoRunNumericId(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function pickLatestExpoRun(
  mode: string | undefined,
  runs: unknown,
): Record<string, unknown> | undefined {
  if (!Array.isArray(runs) || runs.length === 0) {
    return undefined;
  }

  return runs
    .filter(isPlainRecord)
    .reduce<Record<string, unknown> | undefined>((bestRun, candidate) => {
      if (!bestRun) {
        return candidate;
      }

      const candidateStatus = normalizeExpoWorkflowStatus(
        mode,
        candidate.status,
        candidate.conclusion,
      );
      const bestStatus = normalizeExpoWorkflowStatus(mode, bestRun.status, bestRun.conclusion);
      const candidatePendingRank = candidateStatus === 'running' ? 1 : 0;
      const bestPendingRank = bestStatus === 'running' ? 1 : 0;

      if (candidatePendingRank !== bestPendingRank) {
        return candidatePendingRank > bestPendingRank ? candidate : bestRun;
      }

      const candidateTimestamp = Math.max(
        parseExpoRunTimestamp(candidate.updatedAt),
        parseExpoRunTimestamp(candidate.createdAt),
        parseExpoRunTimestamp(candidate.startedAt),
        parseExpoRunTimestamp(candidate.completedAt),
      );
      const bestTimestamp = Math.max(
        parseExpoRunTimestamp(bestRun.updatedAt),
        parseExpoRunTimestamp(bestRun.createdAt),
        parseExpoRunTimestamp(bestRun.startedAt),
        parseExpoRunTimestamp(bestRun.completedAt),
      );

      if (candidateTimestamp !== bestTimestamp) {
        return candidateTimestamp > bestTimestamp ? candidate : bestRun;
      }

      return parseExpoRunNumericId(candidate.id) > parseExpoRunNumericId(bestRun.id)
        ? candidate
        : bestRun;
    }, undefined);
}

export function updateTrackedExpoWorkflowFromRunsPayload(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  toolName: string,
  projectId: string | undefined,
  projectName: string | undefined,
  mode: string | undefined,
  runs: unknown,
): void {
  if (!projectId) {
    return;
  }

  const latestRun = pickLatestExpoRun(mode, runs);
  const workflowRunId = latestRun?.id != null ? String(latestRun.id).trim() : '';
  const status = normalizeExpoWorkflowStatus(mode, latestRun?.status, latestRun?.conclusion);
  if (!workflowRunId || !status) {
    return;
  }

  upsertTrackedExpoWorkflow(trackedOperations, {
    toolName,
    projectId,
    projectName,
    workflowRunId,
    mode,
    status,
  });
}
