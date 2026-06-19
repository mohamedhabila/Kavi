import { extractStringArg } from './support';
import { upsertTrackedAsyncOperation } from './trackerStore';
import type { AsyncOperationStatus, TrackedAsyncOperation } from './types';

function normalizeSshBackgroundJobStatus(status: unknown): AsyncOperationStatus | undefined {
  if (typeof status !== 'string') {
    return undefined;
  }

  switch (status.trim().toLowerCase()) {
    case 'started':
    case 'background':
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
    case 'error':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'timeout':
      return 'timeout';
    default:
      return undefined;
  }
}

function buildSshBackgroundJobOperation(params: {
  toolName: string;
  jobId: string;
  status: AsyncOperationStatus;
}): Omit<TrackedAsyncOperation, 'key' | 'updatedAt'> {
  return {
    kind: 'ssh-background-job',
    resourceId: params.jobId,
    displayName: `SSH background job ${params.jobId}`,
    status: params.status,
    lastUpdatedByTool: params.toolName,
    monitorToolNames: ['ssh_background_job_status', 'ssh_background_job_wait'],
    statusArgs: { jobId: params.jobId },
    waitToolName: 'ssh_background_job_wait',
    waitArgs: { jobId: params.jobId },
  };
}

export function applyTrackedSshToolResult(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  toolName: string,
  toolArguments: string,
  parsedResult: Record<string, unknown> | undefined,
): boolean {
  if (
    toolName !== 'ssh_exec' &&
    toolName !== 'ssh_background_job_status' &&
    toolName !== 'ssh_background_job_wait'
  ) {
    return false;
  }

  const jobId =
    typeof parsedResult?.jobId === 'string'
      ? parsedResult.jobId.trim()
      : extractStringArg(toolArguments, 'jobId');
  const status = normalizeSshBackgroundJobStatus(parsedResult?.status);
  if (!jobId || !status) {
    return true;
  }

  upsertTrackedAsyncOperation(
    trackedOperations,
    buildSshBackgroundJobOperation({
      toolName,
      jobId,
      status,
    }),
  );
  return true;
}
