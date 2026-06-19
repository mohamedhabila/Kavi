import {
  buildPendingAsyncOperationJoinNote,
  buildPendingAsyncOperationResumePrompt,
  buildPendingAsyncOperationSummary,
  getPendingTrackedAsyncOperationToolNames,
} from './asyncTracking/guidance';
import {
  clonePendingTrackedAsyncOperations,
  getPendingTrackedAsyncOperations,
} from './asyncTracking/trackerStore';
import { applyTrackedAsyncToolResult } from './asyncTracking/delivery';
import type { TrackedAsyncOperation } from './asyncTracking/types';

export type { TrackedAsyncOperation } from './asyncTracking/types';
export {
  applyTrackedAsyncToolResult,
  buildPendingAsyncOperationJoinNote,
  buildPendingAsyncOperationResumePrompt,
  buildPendingAsyncOperationSummary,
  clonePendingTrackedAsyncOperations,
  getPendingTrackedAsyncOperationToolNames,
  getPendingTrackedAsyncOperations,
};

export function buildPendingAsyncOperationSignature(
  trackedOperations: ReadonlyMap<string, TrackedAsyncOperation>,
): string {
  return JSON.stringify(
    getPendingTrackedAsyncOperations(trackedOperations)
      .map((operation) => ({
        kind: operation.kind,
        resourceId: operation.resourceId,
        status: operation.status,
        waitToolName: operation.waitToolName,
        waitArgs: operation.waitArgs ? JSON.stringify(operation.waitArgs) : '',
      }))
      .sort((left, right) => {
        const leftKey = `${left.kind}:${left.resourceId}`;
        const rightKey = `${right.kind}:${right.resourceId}`;
        return leftKey.localeCompare(rightKey);
      }),
  );
}
