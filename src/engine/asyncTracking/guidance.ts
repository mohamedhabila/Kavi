import { getPendingTrackedAsyncOperations } from './trackerStore';
import { uniqueToolNames } from './support';
import type { AsyncOperationStatus, TrackedAsyncOperation } from './types';

function formatPendingAsyncOperationLabel(
  operation: Pick<TrackedAsyncOperation, 'kind' | 'displayName' | 'resourceId'>,
): string {
  const displayName = operation.displayName.trim();
  if (displayName) {
    return displayName;
  }

  if (operation.kind === 'session') {
    return `session ${operation.resourceId}`;
  }

  if (operation.kind === 'expo-workflow') {
    return `Expo workflow ${operation.resourceId}`;
  }

  return `SSH background job ${operation.resourceId}`;
}

function humanizeAsyncOperationStatus(status: AsyncOperationStatus): string {
  switch (status) {
    case 'cancel_requested':
      return 'cancelling';
    default:
      return status;
  }
}

function formatPendingAsyncOperationFact(operation: TrackedAsyncOperation): string {
  if (operation.kind === 'session') {
    return `- session ${operation.resourceId}: status=${humanizeAsyncOperationStatus(operation.status)} wait=sessions_wait`;
  }

  if (operation.kind === 'expo-workflow') {
    const projectId =
      typeof operation.statusArgs?.projectId === 'string'
        ? operation.statusArgs.projectId
        : undefined;
    const workflowRunId =
      typeof operation.statusArgs?.workflowRunId === 'string'
        ? operation.statusArgs.workflowRunId
        : undefined;
    if (workflowRunId && projectId) {
      return `- expo workflow ${workflowRunId}: project=${projectId} status=${humanizeAsyncOperationStatus(operation.status)} monitor=expo_eas_workflow_status wait=expo_eas_workflow_wait`;
    }

    return `- expo workflow ${operation.resourceId}: project=${projectId || operation.resourceId} status=unresolved monitor=expo_eas_workflow_runs|expo_eas_workflow_status wait=expo_eas_workflow_wait`;
  }

  return `- ssh background job ${operation.resourceId}: status=${humanizeAsyncOperationStatus(operation.status)} monitor=ssh_background_job_status wait=ssh_background_job_wait`;
}

function stringifyInstructionArgs(args: Record<string, unknown>): string | undefined {
  try {
    return JSON.stringify(args);
  } catch {
    return undefined;
  }
}

function buildPendingAsyncPrimaryActionLine(
  operations: ReadonlyArray<TrackedAsyncOperation>,
): string | undefined {
  if (operations.length === 0) {
    return undefined;
  }

  const sessionOperations = operations.filter(
    (operation) => operation.kind === 'session' && operation.waitToolName === 'sessions_wait',
  );
  if (sessionOperations.length !== operations.length) {
    return undefined;
  }

  const sessionIds = Array.from(
    new Set(
      sessionOperations
        .map((operation) => {
          const waitSessionId =
            typeof operation.waitArgs?.sessionId === 'string'
              ? operation.waitArgs.sessionId.trim()
              : '';
          return waitSessionId || operation.resourceId;
        })
        .filter((sessionId) => sessionId.length > 0),
    ),
  );

  if (sessionIds.length === 0) {
    return undefined;
  }

  const args = sessionIds.length === 1 ? { sessionId: sessionIds[0] } : { sessionIds };
  const serializedArgs = stringifyInstructionArgs(args);
  if (!serializedArgs) {
    return undefined;
  }

  return `Primary wait step: sessions_wait with ${serializedArgs}.`;
}

export function buildPendingAsyncOperationSummary(
  operations: ReadonlyArray<Pick<TrackedAsyncOperation, 'kind' | 'displayName' | 'resourceId'>>,
): string | undefined {
  if (operations.length === 0) {
    return undefined;
  }

  const labels = operations
    .slice(0, 2)
    .map((operation) => formatPendingAsyncOperationLabel(operation));
  const suffix = operations.length > 2 ? ', ...' : '';
  const labelSummary = labels.join(', ');

  return operations.length === 1
    ? `Waiting for ${labelSummary} to finish.`
    : `Waiting for ${operations.length} asynchronous operations to finish (${labelSummary}${suffix}).`;
}

export function buildPendingAsyncOperationResumePrompt(
  operations: ReadonlyArray<TrackedAsyncOperation>,
): string {
  const guidanceLines = operations.slice(0, 8).map(formatPendingAsyncOperationFact);
  const primaryActionLine = buildPendingAsyncPrimaryActionLine(operations);

  return [
    '[SYSTEM ASYNC RESUME]',
    `pending_async_count: ${operations.length}`,
    primaryActionLine,
    'pending_async_operations:',
    ...guidanceLines,
  ].join('\n');
}

export function getPendingTrackedAsyncOperationToolNames(
  trackedOperations: ReadonlyMap<string, TrackedAsyncOperation>,
): string[] {
  const toolNames: string[] = [];

  for (const operation of getPendingTrackedAsyncOperations(trackedOperations)) {
    toolNames.push(...operation.monitorToolNames);
    if (operation.waitToolName) {
      toolNames.push(operation.waitToolName);
    }
  }

  return uniqueToolNames(toolNames);
}

export function buildPendingAsyncOperationJoinNote(
  trackedOperations: ReadonlyMap<string, TrackedAsyncOperation>,
): string | undefined {
  const pendingOperations = getPendingTrackedAsyncOperations(trackedOperations);
  if (pendingOperations.length === 0) {
    return undefined;
  }

  const guidanceLines = pendingOperations.slice(0, 8).map(formatPendingAsyncOperationFact);
  const primaryActionLine = buildPendingAsyncPrimaryActionLine(pendingOperations);

  return [
    '[SYSTEM WORKFLOW JOIN REQUIRED]',
    `pending_async_count: ${pendingOperations.length}`,
    primaryActionLine,
    'pending_async_operations:',
    ...guidanceLines,
  ]
    .filter((line): line is string => typeof line === 'string' && line.length > 0)
    .join('\n');
}
