import {
  createInitialAgentControlGraphSnapshot,
  getAgentControlGraphTurnDirectives,
  reduceAgentControlGraph,
} from '../../src/engine/graph/agentControlGraph';
import {
  buildAgentControlGraphPostToolFinalTextDirectiveEvent,
  buildAgentControlGraphResetIncompleteFinalTextRecoveryEvent,
  buildAgentControlGraphTurnDirectivesConsumedEvent,
  buildAgentControlGraphTurnDirectivesRecordedEvent,
  hasAgentControlGraphOneShotTurnDirectives,
} from '../../src/engine/graph/turnDirectives';

describe('agent control graph turn directives boundary', () => {
  it('builds record events and detects one-shot directives generically', () => {
    const snapshot = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      buildAgentControlGraphTurnDirectivesRecordedEvent(
        {
          forceFinalText: true,
          forcedTextReason: 'workflow_route_completed',
          maxTokensOverride: 8192,
        },
        'workflow_route_completed',
      ),
    ]);
    const directives = getAgentControlGraphTurnDirectives(snapshot);

    expect(directives.forceFinalText).toBe(true);
    expect(directives.forcedTextReason).toBe('workflow_route_completed');
    expect(directives.maxTokensOverride).toBe(8192);
    expect(hasAgentControlGraphOneShotTurnDirectives(directives)).toBe(true);
  });

  it('does not treat incomplete-final recovery bookkeeping as a one-shot model control', () => {
    const snapshot = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      buildAgentControlGraphTurnDirectivesRecordedEvent(
        {
          incompleteFinalTextRecoveryCount: 2,
          incompleteFinalTextContinuationPrefix: 'partial answer',
        },
        'incomplete_delivery_continuation',
      ),
    ]);
    const directives = getAgentControlGraphTurnDirectives(snapshot);

    expect(directives.incompleteFinalTextRecoveryCount).toBe(2);
    expect(directives.incompleteFinalTextContinuationPrefix).toBe('partial answer');
    expect(hasAgentControlGraphOneShotTurnDirectives(directives)).toBe(false);
  });

  it('resets incomplete final text recovery through a graph event', () => {
    const snapshot = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      buildAgentControlGraphTurnDirectivesRecordedEvent(
        {
          incompleteFinalTextRecoveryCount: 2,
          incompleteFinalTextContinuationPrefix: 'partial answer',
        },
        'incomplete_delivery_continuation',
      ),
      buildAgentControlGraphResetIncompleteFinalTextRecoveryEvent('finalization_complete'),
    ]);
    const directives = getAgentControlGraphTurnDirectives(snapshot);

    expect(directives.incompleteFinalTextRecoveryCount).toBe(0);
    expect(directives.incompleteFinalTextContinuationPrefix).toBeUndefined();
  });

  it('builds post-tool final text directives from async terminal resolution', () => {
    expect(
      buildAgentControlGraphPostToolFinalTextDirectiveEvent({
        pendingAsyncCount: 1,
      }),
    ).toBeUndefined();

    expect(
      buildAgentControlGraphPostToolFinalTextDirectiveEvent({
        pendingAsyncCount: 0,
        hasAsyncTerminalResolution: true,
      }),
    ).toEqual(
      buildAgentControlGraphTurnDirectivesRecordedEvent(
        {
          forceFinalText: true,
          forcedTextReason: 'async_terminal_completion',
        },
        'async_terminal_completion',
      ),
    );
  });

  it('forces final text when persistent context is settled after tools', () => {
    expect(
      buildAgentControlGraphPostToolFinalTextDirectiveEvent({
        pendingAsyncCount: 0,
        hasActivePersistentGoal: true,
        hasIncompleteBlockingGoal: false,
      }),
    ).toEqual(
      buildAgentControlGraphTurnDirectivesRecordedEvent(
        {
          forceFinalText: true,
          forcedTextReason: 'persistent_context_settled',
        },
        'persistent_context_settled',
      ),
    );

    expect(
      buildAgentControlGraphPostToolFinalTextDirectiveEvent({
        pendingAsyncCount: 0,
        hasActivePersistentGoal: true,
        hasIncompleteBlockingGoal: true,
      }),
    ).toBeUndefined();
  });

  it('forces final text when blocking goals are completed after tools', () => {
    expect(
      buildAgentControlGraphPostToolFinalTextDirectiveEvent({
        pendingAsyncCount: 0,
        hasCompletedBlockingGoal: true,
        hasIncompleteBlockingGoal: false,
      }),
    ).toEqual(
      buildAgentControlGraphTurnDirectivesRecordedEvent(
        {
          forceFinalText: true,
          forcedTextReason: 'workflow_route_completed',
        },
        'workflow_route_completed',
      ),
    );

    expect(
      buildAgentControlGraphPostToolFinalTextDirectiveEvent({
        pendingAsyncCount: 0,
        hasCompletedBlockingGoal: true,
        hasIncompleteBlockingGoal: true,
      }),
    ).toBeUndefined();
  });

  it('consumes one-shot controls without clearing recovery bookkeeping', () => {
    const snapshot = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      buildAgentControlGraphTurnDirectivesRecordedEvent(
        {
          forceFinalText: true,
          requireWorkflowTool: true,
          maxTokensOverride: 8192,
          incompleteFinalTextRecoveryCount: 1,
          incompleteFinalTextContinuationPrefix: 'partial answer',
        },
        'model_turn_setup',
      ),
      buildAgentControlGraphTurnDirectivesConsumedEvent('model_turn_started'),
    ]);
    const directives = getAgentControlGraphTurnDirectives(snapshot);

    expect(directives.forceFinalText).toBe(false);
    expect(directives.requireWorkflowTool).toBe(false);
    expect(directives.maxTokensOverride).toBeUndefined();
    expect(directives.incompleteFinalTextRecoveryCount).toBe(1);
    expect(directives.incompleteFinalTextContinuationPrefix).toBe('partial answer');
  });
});
