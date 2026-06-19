import { extractStringArg, isPlainRecord } from './support';
import { upsertTrackedAsyncOperation } from './trackerStore';
import type { TrackedAsyncOperation } from './types';
import {
  normalizeExpoWorkflowStatus,
  updateTrackedExpoWorkflowFromRunsPayload,
  upsertTrackedExpoWorkflow,
} from './expoAdapterSupport';

export function applyTrackedExpoToolResult(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  toolName: string,
  toolArguments: string,
  parsedResult: Record<string, unknown> | undefined,
): boolean {
  if (!/^expo_eas_/.test(toolName)) {
    return false;
  }

  const projectId =
    typeof parsedResult?.projectId === 'string' ? parsedResult.projectId.trim() : undefined;
  const projectName =
    typeof parsedResult?.projectName === 'string' ? parsedResult.projectName.trim() : undefined;
  const mode = typeof parsedResult?.mode === 'string' ? parsedResult.mode.trim() : undefined;
  const workflowRun = isPlainRecord(parsedResult?.workflowRun)
    ? parsedResult.workflowRun
    : undefined;
  const workflowRunId = workflowRun?.id != null ? String(workflowRun.id).trim() : '';
  const workflowStatus = normalizeExpoWorkflowStatus(
    mode,
    workflowRun?.status,
    workflowRun?.conclusion,
  );
  const requestedWorkflowRunId =
    extractStringArg(toolArguments, 'workflowRunId') || extractStringArg(toolArguments, 'runId');

  if (workflowRun && workflowRunId && workflowStatus && projectId) {
    upsertTrackedExpoWorkflow(trackedOperations, {
      toolName,
      projectId,
      projectName,
      workflowRunId,
      mode,
      status: workflowStatus,
    });
    return true;
  }

  if (toolName === 'expo_eas_workflow_runs') {
    updateTrackedExpoWorkflowFromRunsPayload(
      trackedOperations,
      toolName,
      projectId,
      projectName,
      mode,
      parsedResult?.runs,
    );
    return true;
  }

  if (
    toolName === 'expo_eas_workflow_status' &&
    parsedResult?.status === 'not_found' &&
    requestedWorkflowRunId
  ) {
    upsertTrackedAsyncOperation(
      trackedOperations,
      {
        kind: 'expo-workflow',
        resourceId: requestedWorkflowRunId,
        displayName: `Expo workflow ${requestedWorkflowRunId}`,
        status: 'failed',
        lastUpdatedByTool: toolName,
        monitorToolNames: ['expo_eas_workflow_status', 'expo_eas_workflow_wait'],
        statusArgs: projectId
          ? { projectId, workflowRunId: requestedWorkflowRunId }
          : { workflowRunId: requestedWorkflowRunId },
        waitToolName: 'expo_eas_workflow_wait',
        waitArgs: projectId
          ? { projectId, workflowRunId: requestedWorkflowRunId }
          : { workflowRunId: requestedWorkflowRunId },
      },
      { onlyUpdateExisting: true },
    );
    return true;
  }

  if (
    projectId &&
    (toolName === 'expo_eas_build' ||
      toolName === 'expo_eas_update' ||
      toolName === 'expo_eas_submit' ||
      toolName === 'expo_eas_deploy_web') &&
    (mode === 'github-workflow' || mode === 'eas-workflow')
  ) {
    upsertTrackedExpoWorkflow(trackedOperations, {
      toolName,
      projectId,
      projectName,
      mode,
      status: 'running',
    });
  }

  return true;
}
