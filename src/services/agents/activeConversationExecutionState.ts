import type { AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import {
  getAgentRunPendingAsyncOperations,
  isAgentRunAwaitingBackgroundWorkers,
} from './agentRunAsyncState';

export type ActiveConversationExecutionKind =
  | 'idle'
  | 'foreground'
  | 'background'
  | 'waiting_for_user'
  | 'needs_attention';

export type AgentRunExecutionPresentation =
  | 'running'
  | 'waiting_for_user'
  | 'needs_attention'
  | 'settled';

export type ActiveConversationExecutionState = {
  activeRun?: AgentRun;
  backgroundEvidence?: 'async_operation' | 'live_worker' | 'recovery_operation';
  canStop: boolean;
  isBusy: boolean;
  kind: ActiveConversationExecutionKind;
};

type ForegroundExecutionState = {
  hasActiveRequest: boolean;
};

type RecoveryExecutionState = {
  hasActiveRecoveryOperation?: boolean;
  hasLiveBackgroundWorker?: boolean;
};

function selectRunningActiveRun(conversation: Conversation | undefined): AgentRun | undefined {
  const activeRunId = conversation?.activeAgentRunId?.trim();
  if (!activeRunId) return undefined;

  return conversation?.agentRuns?.find((run) => run.id === activeRunId && run.status === 'running');
}

/**
 * Owns the user-visible definition of active conversation work.
 *
 * Persisted `running` is historical state, not liveness evidence. A run can
 * present as running only when its active identity is intact and a foreground
 * request, verified async operation, live worker, or in-process recovery owns
 * the work.
 */
export function selectActiveConversationExecutionState(
  conversation: Conversation | undefined,
  foregroundState: ForegroundExecutionState,
  recoveryState: RecoveryExecutionState = {},
): ActiveConversationExecutionState {
  const activeRun = selectRunningActiveRun(conversation);

  if (foregroundState.hasActiveRequest) {
    return {
      activeRun,
      canStop: true,
      isBusy: true,
      kind: 'foreground',
    };
  }

  if (!activeRun) {
    return {
      canStop: false,
      isBusy: false,
      kind: 'idle',
    };
  }

  if (activeRun.controlGraph?.status === 'awaiting_user') {
    return {
      activeRun,
      canStop: false,
      isBusy: false,
      kind: 'waiting_for_user',
    };
  }

  if (recoveryState.hasActiveRecoveryOperation) {
    return {
      activeRun,
      backgroundEvidence: 'recovery_operation',
      canStop: true,
      isBusy: true,
      kind: 'background',
    };
  }

  if (getAgentRunPendingAsyncOperations(activeRun).length > 0) {
    return {
      activeRun,
      backgroundEvidence: 'async_operation',
      canStop: true,
      isBusy: true,
      kind: 'background',
    };
  }

  if (isAgentRunAwaitingBackgroundWorkers(activeRun) && recoveryState.hasLiveBackgroundWorker) {
    return {
      activeRun,
      backgroundEvidence: 'live_worker',
      canStop: true,
      isBusy: true,
      kind: 'background',
    };
  }

  return {
    activeRun,
    canStop: false,
    isBusy: false,
    kind: 'needs_attention',
  };
}

export function selectAgentRunExecutionPresentation(
  run: AgentRun,
  executionState: ActiveConversationExecutionState,
): AgentRunExecutionPresentation {
  if (run.status !== 'running') return 'settled';
  if (executionState.activeRun?.id !== run.id) return 'needs_attention';

  switch (executionState.kind) {
    case 'foreground':
    case 'background':
      return 'running';
    case 'waiting_for_user':
      return 'waiting_for_user';
    default:
      return 'needs_attention';
  }
}
