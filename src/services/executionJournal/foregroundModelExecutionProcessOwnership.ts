const currentProcessModelRunIds = new Set<string>();

export function markForegroundModelExecutionOwnedByCurrentProcess(runId: string): void {
  currentProcessModelRunIds.add(runId);
}

export function isForegroundModelExecutionOwnedByCurrentProcess(runId: string): boolean {
  return currentProcessModelRunIds.has(runId);
}

export function relinquishForegroundModelExecutionProcessOwnership(runId: string): void {
  currentProcessModelRunIds.delete(runId);
}

/** Visible for isolated process-death tests. */
export function _resetForegroundModelExecutionProcessOwnershipForTests(): void {
  currentProcessModelRunIds.clear();
}
