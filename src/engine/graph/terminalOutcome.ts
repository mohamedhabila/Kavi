import type { AgentRunControlGraphState, AgentRunTerminalReason } from '../../types/agentRun';

type AgentControlGraphOutcomeState = Pick<
  AgentRunControlGraphState,
  'status' | 'terminalReason' | 'finalizationHoldReason'
>;

const SUCCESSFUL_GRAPH_STATUSES = new Set<AgentControlGraphOutcomeState['status']>([
  'awaiting_review',
]);

function resolveGraphOutcomeReason(state: AgentControlGraphOutcomeState): string {
  return state.terminalReason?.trim() || state.finalizationHoldReason?.trim() || state.status;
}

export function isAgentControlGraphUnsuccessfulTerminalState(
  state: AgentControlGraphOutcomeState | undefined,
  options?: { allowYieldedCheckpoint?: boolean },
): boolean {
  if (!state) return false;
  return (
    state.status === 'blocked' ||
    state.status === 'cancelled' ||
    state.status === 'failed' ||
    (state.status === 'yielded' && options?.allowYieldedCheckpoint !== true) ||
    (state.status === 'finalized' && state.terminalReason === 'max_iterations')
  );
}

export function isAgentControlGraphFailureResponseState(
  state: AgentControlGraphOutcomeState | undefined,
): boolean {
  return Boolean(
    state &&
    (state.status === 'blocked' ||
      state.status === 'yielded' ||
      (state.status === 'finalized' && state.terminalReason === 'max_iterations')),
  );
}

export function resolveAgentControlGraphTerminalFailure(params: {
  state?: AgentControlGraphOutcomeState;
  reportedError?: Error;
  allowYieldedCheckpoint?: boolean;
}): Error | undefined {
  const state = params.state;
  if (!state) {
    return params.reportedError;
  }

  if (params.reportedError) {
    return params.reportedError;
  }

  if (
    SUCCESSFUL_GRAPH_STATUSES.has(state.status) ||
    (state.status === 'yielded' && params.allowYieldedCheckpoint === true) ||
    (state.status === 'finalized' && state.terminalReason !== 'max_iterations')
  ) {
    return undefined;
  }

  const reason = resolveGraphOutcomeReason(state);
  if (state.status === 'finalized') {
    return new Error(`Agent control graph stopped before completion: ${reason}.`);
  }
  if (state.status === 'blocked') {
    return new Error(`Agent control graph was blocked: ${reason}.`);
  }
  if (state.status === 'cancelled') {
    return new Error(`Agent control graph was cancelled: ${reason}.`);
  }
  if (state.status === 'failed') {
    return new Error(`Agent control graph failed: ${reason}.`);
  }

  return new Error(
    `Agent control graph ended before reaching a successful terminal outcome (${state.status}: ${reason}).`,
  );
}

export function createAgentControlGraphTerminalOutcomeTracker(options?: {
  allowYieldedCheckpoint?: boolean;
}) {
  let state: AgentControlGraphOutcomeState | undefined;
  let reportedError: Error | undefined;
  const resolveFailure = () =>
    resolveAgentControlGraphTerminalFailure({
      state,
      reportedError,
      allowYieldedCheckpoint: options?.allowYieldedCheckpoint,
    });
  const hasControlGraphFailure = () =>
    Boolean(
      state &&
      resolveAgentControlGraphTerminalFailure({
        state,
        allowYieldedCheckpoint: options?.allowYieldedCheckpoint,
      }),
    );

  return {
    recordControlGraphState: (nextState: AgentControlGraphOutcomeState) => {
      state = nextState;
    },
    recordError: (error: Error) => {
      reportedError = error;
    },
    hasControlGraphFailure,
    hasUnsuccessfulTerminalState: () =>
      isAgentControlGraphUnsuccessfulTerminalState(state, options),
    resolveFailure,
    throwIfFailed: () => {
      const failure = resolveFailure();
      if (failure) {
        throw failure;
      }
    },
  };
}

export function classifyAgentControlGraphTerminalReason(
  state: AgentControlGraphOutcomeState,
): AgentRunTerminalReason {
  const reason = resolveGraphOutcomeReason(state).toLowerCase();

  if (reason === 'loop_detected') {
    return 'loop_detected';
  }
  if (reason === 'missing_required_side_effect') {
    return 'missing_required_side_effect';
  }
  if (reason === 'terminal_review_unavailable') {
    return 'terminal_review_unavailable';
  }
  if (reason === 'user_cancelled' || state.status === 'cancelled') {
    return 'user_cancelled';
  }
  if (reason === 'route_blocked' || reason.includes('route')) {
    return 'route_blocked';
  }
  if (
    reason === 'tool_failure' ||
    reason.includes('tool') ||
    reason.includes('incomplete_batch') ||
    reason.includes('batch_incomplete')
  ) {
    return 'tool_failure';
  }

  return 'terminal_blocked';
}
