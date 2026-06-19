import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import {
buildPendingAsyncOperationJoinNote,
type TrackedAsyncOperation as PendingTrackedAsyncOperation,
} from '../pendingAsyncOperations';
import type { AgentControlGraphEvent } from './agentControlGraphTypes';

export type AgentControlGraphPendingAsyncFinalizationCommand =
  | { type: 'ready' }
  | {
      type: 'hold';
      reason: 'async_waiting_finalization_hold';
      graphEvent: Extract<AgentControlGraphEvent, { type: 'ASYNC_WAITING' }>;
      nextNoToolTurnCount: number;
      systemPrompts: string[];
    };

export function buildAgentControlGraphAsyncFinalizationHoldNote(): string {
  return [
    '[SYSTEM ASYNC HOLD]',
    'pending_async_state: active',
    'finalization_ready: false',
  ].join('\n');
}

export function buildAgentControlGraphPendingAsyncNoToolCorrectionNote(
  pendingOperations: ReadonlyArray<PendingTrackedAsyncOperation>,
): string {
  const visibleLabels = pendingOperations
    .slice(0, 2)
    .map((operation) => operation.displayName || operation.resourceId)
    .filter(Boolean);
  const hiddenCount = pendingOperations.length - visibleLabels.length;
  const operationSummary =
    visibleLabels.length === 0
      ? `${pendingOperations.length} pending asynchronous operation${pendingOperations.length === 1 ? '' : 's'}`
      : hiddenCount > 0
        ? `${visibleLabels.join(', ')}, and ${hiddenCount} more pending operation${hiddenCount === 1 ? '' : 's'}`
        : visibleLabels.join(', ');

  return [
    '[SYSTEM ASYNC MONITOR REQUIRED]',
    `pending_async_operations: ${operationSummary}.`,
    'next_action: monitor_or_wait',
  ].join('\n');
}

export function buildAgentControlGraphPendingAsyncFinalizationCommand(params: {
  trackedOperations: ReadonlyMap<string, TrackedAsyncOperation>;
  pendingOperations: ReadonlyArray<TrackedAsyncOperation>;
  previousNoToolTurnCount: number;
  hasDraftContent: boolean;
}): AgentControlGraphPendingAsyncFinalizationCommand {
  if (params.pendingOperations.length === 0) {
    return { type: 'ready' };
  }

  const nextNoToolTurnCount = Math.max(0, Math.floor(params.previousNoToolTurnCount)) + 1;
  const systemPrompts: string[] = [];
  if (params.hasDraftContent) {
    systemPrompts.push(buildAgentControlGraphAsyncFinalizationHoldNote());
  }
  if (nextNoToolTurnCount >= 2) {
    systemPrompts.push(
      buildAgentControlGraphPendingAsyncNoToolCorrectionNote(params.pendingOperations),
    );
  }

  const joinNote = buildPendingAsyncOperationJoinNote(params.trackedOperations);
  if (joinNote) {
    systemPrompts.push(joinNote);
  }

  return {
    type: 'hold',
    reason: 'async_waiting_finalization_hold',
    graphEvent: {
      type: 'ASYNC_WAITING',
      pendingAsyncCount: params.pendingOperations.length,
      pendingOperations: [...params.pendingOperations],
    },
    nextNoToolTurnCount,
    systemPrompts,
  };
}
