import type { ConversationLogEntry } from '../../types/conversation';
import type { ConversationRunCompletionEffect } from './applyRunCompletionEffect';

const USER_STOP_REASON = 'Cancelled because the supervising turn was stopped by the user.';
const USER_SUPERSEDE_OPERATION_REASON = 'Superseded by a new user turn.';
const USER_SUPERSEDE_WORKER_REASON = 'Cancelled because a new user turn superseded the active run.';

type ForegroundRunTerminalLogEntry = Pick<
  ConversationLogEntry,
  'kind' | 'level' | 'title' | 'detail'
>;

export type ForegroundRunTerminalEffect = {
  completion: ConversationRunCompletionEffect;
  logEntry: ForegroundRunTerminalLogEntry;
  operationReason: string;
  workerReason: string;
};

export function buildCancelledRunSummary(cancelledWorkerCount: number): string {
  return cancelledWorkerCount === 1
    ? 'The current run was cancelled and 1 background worker was stopped.'
    : cancelledWorkerCount > 1
      ? `The current run was cancelled and ${cancelledWorkerCount} background workers were stopped.`
      : 'The current run was cancelled.';
}

export function buildSupersededRunSummary(cancelledWorkerCount: number): string {
  return cancelledWorkerCount === 1
    ? 'A new user turn started before the previous run finished and 1 background worker was stopped.'
    : cancelledWorkerCount > 1
      ? `A new user turn started before the previous run finished and ${cancelledWorkerCount} background workers were stopped.`
      : 'A new user turn started before the previous run finished.';
}

export function buildStoppedBackgroundWorkerDetail(
  cancelledWorkerCount: number,
): string | undefined {
  return cancelledWorkerCount === 1
    ? '1 background worker was stopped.'
    : cancelledWorkerCount > 1
      ? `${cancelledWorkerCount} background workers were stopped.`
      : undefined;
}

export function buildForegroundRunAbortCompletionEffect(): ConversationRunCompletionEffect {
  return {
    status: 'cancelled',
    latestSummary: buildCancelledRunSummary(0),
    checkpointTitle: 'Turn cancelled',
    checkpointDetail: buildCancelledRunSummary(0),
    terminalReason: 'user_cancelled',
  };
}

export function buildForegroundRunFailureEffect(detail: string): {
  chatError: string;
  completion: ConversationRunCompletionEffect;
  logEntry: ForegroundRunTerminalLogEntry;
} {
  return {
    chatError: detail,
    completion: {
      status: 'failed',
      latestSummary: detail,
      checkpointTitle: 'Turn failed',
      checkpointDetail: detail,
      terminalReason: 'tool_failure',
    },
    logEntry: {
      kind: 'error',
      level: 'error',
      title: 'Request failed',
      detail,
    },
  };
}

export function buildForegroundRunSupersededEffect(
  cancelledWorkerCount: number,
): ForegroundRunTerminalEffect {
  const latestSummary = buildSupersededRunSummary(cancelledWorkerCount);
  return {
    operationReason: USER_SUPERSEDE_OPERATION_REASON,
    workerReason: USER_SUPERSEDE_WORKER_REASON,
    completion: {
      status: 'cancelled',
      latestSummary,
      checkpointTitle: 'Run superseded',
      checkpointDetail: latestSummary,
      terminalReason: 'user_cancelled',
    },
    logEntry: {
      kind: 'system',
      level: 'warning',
      title:
        cancelledWorkerCount > 0
          ? 'Previous run superseded and workers cancelled'
          : 'Previous run superseded',
      detail: latestSummary,
    },
  };
}

export function buildForegroundRunUserStopCompletionEffect(
  cancelledWorkerCount: number,
): ConversationRunCompletionEffect & {
  operationReason: string;
  workerReason: string;
} {
  const latestSummary = buildCancelledRunSummary(cancelledWorkerCount);
  return {
    operationReason: USER_STOP_REASON,
    workerReason: USER_STOP_REASON,
    status: 'cancelled',
    latestSummary,
    checkpointTitle: 'Turn cancelled',
    checkpointDetail: latestSummary,
    terminalReason: 'user_cancelled',
  };
}

export function buildForegroundRunUserStopLogEntry(params: {
  cancelledRunCount: number;
  cancelledWorkerCount: number;
}): ForegroundRunTerminalLogEntry {
  return {
    kind: 'system',
    level: 'warning',
    title:
      params.cancelledWorkerCount > 0
        ? 'Generation stopped and workers cancelled'
        : 'Generation stopped',
    detail:
      params.cancelledRunCount > 0
        ? buildCancelledRunSummary(params.cancelledWorkerCount)
        : 'The current response was cancelled by the user.',
  };
}
