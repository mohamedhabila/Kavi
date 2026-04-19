import type {
  AgentRunAsyncOperation,
  AgentRunAsyncOperationKind,
  AgentRunAsyncOperationStatus,
} from '../types';

type AsyncOperationKind = AgentRunAsyncOperationKind;

type AsyncOperationStatus = AgentRunAsyncOperationStatus;

export interface TrackedAsyncOperation extends AgentRunAsyncOperation {}

const TERMINAL_OPERATION_STATUSES = new Set<AsyncOperationStatus>([
  'completed',
  'failed',
  'cancelled',
  'timeout',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function extractStringArg(argumentsText: string, key: string): string | undefined {
  const parsedArgs = parseJsonRecord(argumentsText);
  const value = typeof parsedArgs?.[key] === 'string' ? String(parsedArgs[key]).trim() : '';
  return value || undefined;
}

function buildTrackedAsyncOperationKey(kind: AsyncOperationKind, resourceId: string): string {
  return `${kind}:${resourceId}`;
}

function uniqueToolNames(toolNames: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(toolNames).filter(Boolean)));
}

function buildProjectScopedExpoResourceId(projectId: string): string {
  return `project:${projectId}`;
}

function upsertTrackedAsyncOperation(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  operation: Omit<TrackedAsyncOperation, 'key' | 'updatedAt'>,
  options?: { onlyUpdateExisting?: boolean },
): void {
  const normalizedResourceId = operation.resourceId.trim();
  if (!normalizedResourceId) {
    return;
  }

  const key = buildTrackedAsyncOperationKey(operation.kind, normalizedResourceId);
  const existing = trackedOperations.get(key);
  if (!existing && options?.onlyUpdateExisting) {
    return;
  }

  trackedOperations.set(key, {
    key,
    ...existing,
    ...operation,
    updatedAt: Date.now(),
    resourceId: normalizedResourceId,
    displayName: operation.displayName || existing?.displayName || normalizedResourceId,
    monitorToolNames: uniqueToolNames(
      operation.monitorToolNames.length
        ? operation.monitorToolNames
        : (existing?.monitorToolNames ?? []),
    ),
    ...(operation.waitToolName || existing?.waitToolName
      ? { waitToolName: operation.waitToolName ?? existing?.waitToolName }
      : {}),
    ...(operation.statusArgs || existing?.statusArgs
      ? { statusArgs: operation.statusArgs ?? existing?.statusArgs }
      : {}),
    ...(operation.waitArgs || existing?.waitArgs
      ? { waitArgs: operation.waitArgs ?? existing?.waitArgs }
      : {}),
  });
}

function deleteTrackedAsyncOperation(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  kind: AsyncOperationKind,
  resourceId: string | undefined,
): void {
  const normalizedResourceId = resourceId?.trim();
  if (!normalizedResourceId) {
    return;
  }

  trackedOperations.delete(buildTrackedAsyncOperationKey(kind, normalizedResourceId));
}

function deleteTrackedAsyncOperationsByKind(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  kind: AsyncOperationKind,
): void {
  for (const [key, operation] of trackedOperations.entries()) {
    if (operation.kind === kind) {
      trackedOperations.delete(key);
    }
  }
}

function normalizeSessionStatus(status: unknown): AsyncOperationStatus | undefined {
  if (typeof status !== 'string') {
    return undefined;
  }

  switch (status.trim().toLowerCase()) {
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
    case 'cancel_requested':
      return 'cancel_requested';
    default:
      return undefined;
  }
}

function markMissingTrackedSessionFailed(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  toolName: string,
  toolArguments: string,
  toolResult: string,
): void {
  if (!/^Error:\s*session not found:/i.test(toolResult)) {
    return;
  }

  const sessionId = extractStringArg(toolArguments, 'sessionId');
  if (!sessionId) {
    return;
  }

  upsertTrackedAsyncOperation(
    trackedOperations,
    {
      kind: 'session',
      resourceId: sessionId,
      displayName: `Session ${sessionId}`,
      status: 'failed',
      lastUpdatedByTool: toolName,
      monitorToolNames: ['sessions_status', 'sessions_wait', 'sessions_cancel'],
      statusArgs: { sessionId },
      waitToolName: 'sessions_wait',
      waitArgs: { sessionId },
    },
    { onlyUpdateExisting: true },
  );
}

function updateTrackedSessionsFromSessionCollection(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  entries: unknown,
  toolName: string,
  options?: { onlyUpdateExisting?: boolean },
): void {
  if (!Array.isArray(entries)) {
    return;
  }

  for (const entry of entries) {
    if (!isPlainRecord(entry)) {
      continue;
    }

    const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId.trim() : '';
    const status = normalizeSessionStatus(entry.status);
    if (!sessionId || !status) {
      continue;
    }

    upsertTrackedAsyncOperation(
      trackedOperations,
      {
        kind: 'session',
        resourceId: sessionId,
        displayName: `Session ${sessionId}`,
        status,
        lastUpdatedByTool: toolName,
        monitorToolNames: ['sessions_status', 'sessions_wait', 'sessions_cancel'],
        statusArgs: { sessionId },
        waitToolName: 'sessions_wait',
        waitArgs: { sessionId },
      },
      options,
    );
  }
}

function normalizeExpoWorkflowStatus(
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

function upsertTrackedExpoWorkflow(
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

function updateTrackedExpoWorkflowFromRunsPayload(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  toolName: string,
  projectId: string | undefined,
  projectName: string | undefined,
  mode: string | undefined,
  runs: unknown,
): void {
  if (!projectId || !Array.isArray(runs) || runs.length === 0) {
    return;
  }

  const parseExpoRunTimestamp = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
  };

  const parseExpoRunNumericId = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
  };

  const latestRun = runs
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

      const candidateNumericId = parseExpoRunNumericId(candidate.id);
      const bestNumericId = parseExpoRunNumericId(bestRun.id);
      return candidateNumericId > bestNumericId ? candidate : bestRun;
    }, undefined);

  if (!latestRun) {
    return;
  }

  const workflowRunId = latestRun.id != null ? String(latestRun.id).trim() : '';
  const status = normalizeExpoWorkflowStatus(mode, latestRun.status, latestRun.conclusion);
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

function cloneAsyncOperationArgs(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return { ...value };
}

function cloneTrackedAsyncOperation(operation: TrackedAsyncOperation): TrackedAsyncOperation {
  return {
    ...operation,
    monitorToolNames: [...operation.monitorToolNames],
    ...(operation.statusArgs ? { statusArgs: cloneAsyncOperationArgs(operation.statusArgs) } : {}),
    ...(operation.waitArgs ? { waitArgs: cloneAsyncOperationArgs(operation.waitArgs) } : {}),
  };
}

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

function formatPendingAsyncOperationGuidance(operation: TrackedAsyncOperation): string {
  if (operation.kind === 'session') {
    return `Session ${operation.resourceId} is still ${humanizeAsyncOperationStatus(operation.status)}. Call sessions_wait with sessionId "${operation.resourceId}" if you need to block until its output is ready, or call sessions_status for live inspection. Use sessions_cancel only if the worker is drifting or redundant.`;
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
      return `Expo workflow ${workflowRunId} for project ${projectId} is still ${humanizeAsyncOperationStatus(operation.status)}. Call expo_eas_workflow_wait or expo_eas_workflow_status with that projectId and workflowRunId until it reaches a terminal state.`;
    }

    return `An Expo workflow for project ${projectId || operation.resourceId} is still unresolved. Call expo_eas_workflow_runs or expo_eas_workflow_status with that projectId to locate the active run, then continue with expo_eas_workflow_wait until it is terminal.`;
  }

  return `SSH background job ${operation.resourceId} is still ${humanizeAsyncOperationStatus(operation.status)}. Call ssh_background_job_wait or ssh_background_job_status with that jobId until it reaches a terminal state.`;
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

  return `Primary next step when you need worker outputs: call sessions_wait with ${serializedArgs}.`;
}

export function applyTrackedAsyncToolResult(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  toolName: string,
  toolArguments: string,
  toolResult: string,
): void {
  if (/^sessions_/.test(toolName)) {
    const parsedResult = parseJsonRecord(toolResult);
    const fallbackSessionId = extractStringArg(toolArguments, 'sessionId');

    switch (toolName) {
      case 'sessions_spawn':
      case 'sessions_send': {
        const sessionId =
          typeof parsedResult?.sessionId === 'string' ? parsedResult.sessionId.trim() : undefined;
        const status = normalizeSessionStatus(parsedResult?.status);
        if (!sessionId || !status) {
          return;
        }

        upsertTrackedAsyncOperation(trackedOperations, {
          kind: 'session',
          resourceId: sessionId,
          displayName: `Session ${sessionId}`,
          status,
          lastUpdatedByTool: toolName,
          monitorToolNames: ['sessions_status', 'sessions_wait', 'sessions_cancel'],
          statusArgs: { sessionId },
          waitToolName: 'sessions_wait',
          waitArgs: { sessionId },
        });
        return;
      }

      case 'sessions_status':
      case 'sessions_history':
      case 'sessions_output':
      case 'sessions_surface_output':
      case 'sessions_cancel': {
        const sessionId =
          typeof parsedResult?.sessionId === 'string'
            ? parsedResult.sessionId.trim()
            : fallbackSessionId;
        const status = normalizeSessionStatus(parsedResult?.status);
        if (sessionId && status) {
          upsertTrackedAsyncOperation(
            trackedOperations,
            {
              kind: 'session',
              resourceId: sessionId,
              displayName: `Session ${sessionId}`,
              status,
              lastUpdatedByTool: toolName,
              monitorToolNames: ['sessions_status', 'sessions_wait', 'sessions_cancel'],
              statusArgs: { sessionId },
              waitToolName: 'sessions_wait',
              waitArgs: { sessionId },
            },
            { onlyUpdateExisting: true },
          );
        }
        markMissingTrackedSessionFailed(trackedOperations, toolName, toolArguments, toolResult);
        return;
      }

      case 'sessions_wait': {
        const sessionCount =
          typeof parsedResult?.sessionCount === 'number' ? parsedResult.sessionCount : undefined;
        const waitedForConversationSessions = parsedResult?.waitedForConversationSessions === true;
        if (
          parsedResult?.status === 'completed' &&
          waitedForConversationSessions &&
          sessionCount === 0
        ) {
          deleteTrackedAsyncOperationsByKind(trackedOperations, 'session');
          return;
        }

        updateTrackedSessionsFromSessionCollection(
          trackedOperations,
          parsedResult?.sessions,
          toolName,
        );
        return;
      }

      case 'sessions_yield': {
        const status =
          typeof parsedResult?.status === 'string' ? parsedResult.status.trim().toLowerCase() : '';
        const pendingSessions = Array.isArray(parsedResult?.pendingSessions)
          ? parsedResult.pendingSessions
          : undefined;

        if (status === 'completed' && pendingSessions?.length === 0) {
          deleteTrackedAsyncOperationsByKind(trackedOperations, 'session');
          return;
        }

        updateTrackedSessionsFromSessionCollection(trackedOperations, pendingSessions, toolName);
        return;
      }

      case 'sessions_list': {
        updateTrackedSessionsFromSessionCollection(
          trackedOperations,
          parsedResult?.sessions,
          toolName,
          { onlyUpdateExisting: true },
        );
        return;
      }
    }
  }

  if (/^expo_eas_/.test(toolName)) {
    const parsedResult = parseJsonRecord(toolResult);
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
      return;
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
      return;
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
      return;
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
    return;
  }

  if (
    toolName === 'ssh_exec' ||
    toolName === 'ssh_background_job_status' ||
    toolName === 'ssh_background_job_wait'
  ) {
    const parsedResult = parseJsonRecord(toolResult);
    const jobId =
      typeof parsedResult?.jobId === 'string'
        ? parsedResult.jobId.trim()
        : extractStringArg(toolArguments, 'jobId');
    const status = normalizeSshBackgroundJobStatus(parsedResult?.status);
    if (!jobId || !status) {
      return;
    }

    upsertTrackedAsyncOperation(
      trackedOperations,
      buildSshBackgroundJobOperation({
        toolName,
        jobId,
        status,
      }),
    );
  }
}

export function getPendingTrackedAsyncOperations(
  trackedOperations: ReadonlyMap<string, TrackedAsyncOperation>,
): TrackedAsyncOperation[] {
  return Array.from(trackedOperations.values()).filter(
    (operation) => !TERMINAL_OPERATION_STATUSES.has(operation.status),
  );
}

export function clonePendingTrackedAsyncOperations(
  trackedOperations: ReadonlyMap<string, TrackedAsyncOperation>,
): TrackedAsyncOperation[] {
  return getPendingTrackedAsyncOperations(trackedOperations).map((operation) =>
    cloneTrackedAsyncOperation(operation),
  );
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
  const guidanceLines = operations
    .slice(0, 8)
    .map((operation) => `- ${formatPendingAsyncOperationGuidance(operation)}`);

  return [
    '## Recovered Async Workflow State',
    'The previous agent run was interrupted while asynchronous tool work was still pending.',
    'Resume monitoring the existing asynchronous operations instead of restarting the task or launching unrelated work.',
    'Pending operations:',
    ...guidanceLines,
    'Use only the relevant monitor or wait tools until every pending operation reaches a terminal state.',
    'Do not repeat the original triggering tool unless monitoring shows that recovery truly requires a new run.',
    'After every pending operation is terminal, reassess the evidence and continue the normal completion flow.',
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

  const guidanceLines = pendingOperations
    .slice(0, 8)
    .map((operation) => `- ${formatPendingAsyncOperationGuidance(operation)}`);
  const primaryActionLine = buildPendingAsyncPrimaryActionLine(pendingOperations);

  return [
    '[SYSTEM WORKFLOW JOIN REQUIRED]',
    'Asynchronous tool work is still unresolved.',
    'Do not produce the final user-facing answer and do not start unrelated tools.',
    'Resolve every pending operation before you finalize:',
    primaryActionLine,
    ...guidanceLines,
    'Only deliver the final answer after every pending operation reaches a terminal state (completed, failed, cancelled, or timeout).',
  ].join('\n');
}
