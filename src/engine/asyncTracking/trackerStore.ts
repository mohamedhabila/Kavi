import {
  cloneTrackedAsyncOperation,
  buildTrackedAsyncOperationKey,
  uniqueToolNames,
} from './support';
import {
  TERMINAL_OPERATION_STATUSES,
  type AsyncOperationKind,
  type TrackedAsyncOperation,
} from './types';

export function upsertTrackedAsyncOperation(
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
    blocksFinalization: operation.blocksFinalization ?? existing?.blocksFinalization ?? true,
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

export function deleteTrackedAsyncOperation(
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

export function deleteTrackedAsyncOperationsByKind(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  kind: AsyncOperationKind,
): void {
  for (const [key, operation] of trackedOperations.entries()) {
    if (operation.kind === kind) {
      trackedOperations.delete(key);
    }
  }
}

export function getPendingTrackedAsyncOperations(
  trackedOperations: ReadonlyMap<string, TrackedAsyncOperation>,
): TrackedAsyncOperation[] {
  return Array.from(trackedOperations.values()).filter(
    (operation) =>
      !TERMINAL_OPERATION_STATUSES.has(operation.status) && operation.blocksFinalization !== false,
  );
}

export function clonePendingTrackedAsyncOperations(
  trackedOperations: ReadonlyMap<string, TrackedAsyncOperation>,
): TrackedAsyncOperation[] {
  return getPendingTrackedAsyncOperations(trackedOperations).map((operation) =>
    cloneTrackedAsyncOperation(operation),
  );
}
