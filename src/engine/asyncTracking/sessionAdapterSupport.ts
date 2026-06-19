import { buildTrackedAsyncOperationKey, extractStringArg, isPlainRecord } from './support';
import { upsertTrackedAsyncOperation } from './trackerStore';
import type { AsyncOperationStatus, TrackedAsyncOperation } from './types';

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

function buildSessionMonitorArgs(
  sessionId: string,
  workstreamId: string | undefined,
): Record<string, unknown> {
  return workstreamId ? { sessionId, workstreamId } : { sessionId };
}

function resolveSessionWorkstreamId(
  trackedOperations: ReadonlyMap<string, TrackedAsyncOperation>,
  sessionId: string,
  toolArguments: string,
): string | undefined {
  const explicitWorkstreamId = extractStringArg(toolArguments, 'workstreamId');
  if (explicitWorkstreamId) {
    return explicitWorkstreamId;
  }

  const existing = trackedOperations.get(buildTrackedAsyncOperationKey('session', sessionId));
  const existingStatusWorkstreamId =
    typeof existing?.statusArgs?.workstreamId === 'string'
      ? existing.statusArgs.workstreamId.trim()
      : '';
  if (existingStatusWorkstreamId) {
    return existingStatusWorkstreamId;
  }

  const existingWaitWorkstreamId =
    typeof existing?.waitArgs?.workstreamId === 'string'
      ? existing.waitArgs.workstreamId.trim()
      : '';
  return existingWaitWorkstreamId || undefined;
}

function shouldBlockFinalizationForSessionTool(toolName: string, toolArguments: string): boolean {
  if (toolName === 'sessions_wait') {
    return true;
  }

  if (toolName !== 'sessions_spawn' && toolName !== 'sessions_send') {
    return true;
  }

  try {
    const parsed = JSON.parse(toolArguments) as Record<string, unknown>;
    return parsed?.waitForCompletion === true;
  } catch {
    return false;
  }
}

export function readSessionStatus(status: unknown): AsyncOperationStatus | undefined {
  return normalizeSessionStatus(status);
}

export function upsertTrackedSession(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  params: {
    sessionId: string;
    status: AsyncOperationStatus;
    toolName: string;
    toolArguments: string;
  },
  options?: { onlyUpdateExisting?: boolean },
): void {
  const workstreamId = resolveSessionWorkstreamId(
    trackedOperations,
    params.sessionId,
    params.toolArguments,
  );

  upsertTrackedAsyncOperation(
    trackedOperations,
    {
      kind: 'session',
      resourceId: params.sessionId,
      displayName: `Session ${params.sessionId}`,
      status: params.status,
      blocksFinalization: shouldBlockFinalizationForSessionTool(
        params.toolName,
        params.toolArguments,
      ),
      lastUpdatedByTool: params.toolName,
      monitorToolNames: ['sessions_wait', 'sessions_cancel'],
      statusArgs: buildSessionMonitorArgs(params.sessionId, workstreamId),
      waitToolName: 'sessions_wait',
      waitArgs: buildSessionMonitorArgs(params.sessionId, workstreamId),
    },
    options,
  );
}

export function markMissingTrackedSessionFailed(
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

  upsertTrackedSession(
    trackedOperations,
    {
      sessionId,
      status: 'failed',
      toolName,
      toolArguments,
    },
    { onlyUpdateExisting: true },
  );
}

export function updateTrackedSessionsFromCollection(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  entries: unknown,
  toolName: string,
  toolArguments: string,
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

    upsertTrackedSession(
      trackedOperations,
      { sessionId, status, toolName, toolArguments },
      options,
    );
  }
}
