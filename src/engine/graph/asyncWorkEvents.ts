import {
  clonePendingTrackedAsyncOperations,
  type TrackedAsyncOperation,
} from '../pendingAsyncOperations';
import type { AgentControlGraphEvent } from './agentControlGraphTypes';

export function buildAgentControlGraphAsyncWaitingEvent(
  trackedOperations: ReadonlyMap<string, TrackedAsyncOperation>,
  options: {
    awaitingBackgroundWorkers?: boolean;
    timestamp?: number;
  } = {},
): Extract<AgentControlGraphEvent, { type: 'ASYNC_WAITING' }> {
  const pendingOperations = clonePendingTrackedAsyncOperations(trackedOperations);
  return {
    type: 'ASYNC_WAITING',
    pendingAsyncCount: pendingOperations.length,
    pendingOperations,
    ...(options.awaitingBackgroundWorkers !== undefined
      ? { awaitingBackgroundWorkers: options.awaitingBackgroundWorkers }
      : {}),
    ...(options.timestamp !== undefined ? { timestamp: options.timestamp } : {}),
  };
}
