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

/**
 * The one post-tool turn the graph forces to text: a detached background session was
 * started and nothing waits on it, so control goes back to the person. Every other
 * request ends when the model answers. Directives keyed on goal state ended requests the
 * model was still working on and were removed with goal gating.
 */
export function buildAgentControlGraphPostToolFinalTextDirectiveEvent(params: {
  pendingAsyncCount: number;
  hasBackgroundLaunchWithoutWait?: boolean;
}): Extract<AgentControlGraphEvent, { type: 'TURN_DIRECTIVES_RECORDED' }> | undefined {
  if (params.pendingAsyncCount === 0 && params.hasBackgroundLaunchWithoutWait === true) {
    return buildAgentControlGraphTurnDirectivesRecordedEvent(
      {
        forceFinalText: true,
        forcedTextReason: 'background_session_started',
      },
      'background_session_started',
    );
  }

  return undefined;
}

export function hasAgentControlGraphOneShotTurnDirectives(
  directives: AgentControlTurnDirectives,
): boolean {
  return directives.forceFinalText || directives.maxTokensOverride !== undefined;
}
