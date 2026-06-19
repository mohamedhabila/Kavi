import type { AgentControlGraphEvent, AgentControlTurnDirectives } from './agentControlGraph';

export function buildAgentControlGraphTurnDirectivesRecordedEvent(
  directives: Partial<AgentControlTurnDirectives>,
  reason: string,
): Extract<AgentControlGraphEvent, { type: 'TURN_DIRECTIVES_RECORDED' }> {
  return {
    type: 'TURN_DIRECTIVES_RECORDED',
    directives,
    reason,
  };
}

export function buildAgentControlGraphTurnDirectivesConsumedEvent(
  reason: string,
): Extract<AgentControlGraphEvent, { type: 'TURN_DIRECTIVES_CONSUMED' }> {
  return {
    type: 'TURN_DIRECTIVES_CONSUMED',
    reason,
  };
}

export function buildAgentControlGraphResetIncompleteFinalTextRecoveryEvent(
  reason: string,
): Extract<AgentControlGraphEvent, { type: 'TURN_DIRECTIVES_RECORDED' }> {
  return buildAgentControlGraphTurnDirectivesRecordedEvent(
    {
      incompleteFinalTextRecoveryCount: 0,
      incompleteFinalTextContinuationPrefix: '',
    },
    reason,
  );
}

export function buildAgentControlGraphPostToolFinalTextDirectiveEvent(params: {
  pendingAsyncCount: number;
  hasAsyncTerminalResolution?: boolean;
  hasActivePersistentGoal?: boolean;
  hasCompletedBlockingGoal?: boolean;
  hasIncompleteBlockingGoal?: boolean;
}): Extract<AgentControlGraphEvent, { type: 'TURN_DIRECTIVES_RECORDED' }> | undefined {
  if (params.pendingAsyncCount === 0 && params.hasAsyncTerminalResolution === true) {
    return buildAgentControlGraphTurnDirectivesRecordedEvent(
      {
        forceFinalText: true,
        forcedTextReason: 'async_terminal_completion',
      },
      'async_terminal_completion',
    );
  }

  if (
    params.pendingAsyncCount === 0 &&
    params.hasCompletedBlockingGoal === true &&
    params.hasIncompleteBlockingGoal !== true
  ) {
    return buildAgentControlGraphTurnDirectivesRecordedEvent(
      {
        forceFinalText: true,
        forcedTextReason: 'workflow_route_completed',
      },
      'workflow_route_completed',
    );
  }

  if (
    params.pendingAsyncCount === 0 &&
    params.hasActivePersistentGoal === true &&
    params.hasIncompleteBlockingGoal !== true
  ) {
    return buildAgentControlGraphTurnDirectivesRecordedEvent(
      {
        forceFinalText: true,
        forcedTextReason: 'persistent_context_settled',
      },
      'persistent_context_settled',
    );
  }

  return undefined;
}

export function hasAgentControlGraphOneShotTurnDirectives(
  directives: AgentControlTurnDirectives,
): boolean {
  return (
    directives.forceFinalText ||
    directives.maxTokensOverride !== undefined
  );
}
