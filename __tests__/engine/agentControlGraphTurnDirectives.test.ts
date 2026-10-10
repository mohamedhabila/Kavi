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
          forcedTextReason: 'yield_finalization',
          maxTokensOverride: 8192,
        },
        'yield_finalization',
      ),
    ]);
    const directives = getAgentControlGraphTurnDirectives(snapshot);

    expect(directives.forceFinalText).toBe(true);
    expect(directives.forcedTextReason).toBe('yield_finalization');
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

  it('hands control back after a successful non-blocking background launch', () => {
    expect(
      buildAgentControlGraphPostToolFinalTextDirectiveEvent({
        pendingAsyncCount: 0,
        hasBackgroundLaunchWithoutWait: true,
      }),
    ).toEqual(
      buildAgentControlGraphTurnDirectivesRecordedEvent(
        {
          forceFinalText: true,
          forcedTextReason: 'background_session_started',
        },
        'background_session_started',
      ),
    );

    expect(
      buildAgentControlGraphPostToolFinalTextDirectiveEvent({
        pendingAsyncCount: 1,
        hasBackgroundLaunchWithoutWait: true,
      }),
    ).toBeUndefined();

  });

  it('leaves the next turn its tools after any other batch', () => {
    // The model ends a request by answering. Forcing text on goal state ended a traced
    // calendar request after the model had only looked up its tools.
    expect(
      buildAgentControlGraphPostToolFinalTextDirectiveEvent({
        pendingAsyncCount: 0,
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
          automaticRecoveryAttemptCount: 1,
          mobileControllerRecovery: {
            version: 1,
            phase: 'tracking',
            strategyFingerprint: `sha256:${'a'.repeat(64)}`,
            consecutiveStallCount: 2,
          },
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
    expect(directives.automaticRecoveryAttemptCount).toBe(1);
    expect(directives.mobileControllerRecovery).toEqual(
      expect.objectContaining({ phase: 'tracking', consecutiveStallCount: 2 }),
    );
  });
});
