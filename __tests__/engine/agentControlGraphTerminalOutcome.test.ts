import {
  classifyAgentControlGraphTerminalReason,
  createAgentControlGraphTerminalOutcomeTracker,
  isAgentControlGraphFailureResponseState,
  resolveAgentControlGraphTerminalFailure,
} from '../../src/engine/graph/terminalOutcome';
import type { AgentRunControlGraphState } from '../../src/types/agentRun';

function state(
  status: AgentRunControlGraphState['status'],
  terminalReason?: string,
): AgentRunControlGraphState {
  return { status, terminalReason } as AgentRunControlGraphState;
}

describe('agent control graph terminal outcomes', () => {
  it.each([state('awaiting_review'), state('finalized', 'completed')])(
    'accepts successful graph completion at $status',
    (controlGraph) => {
      expect(resolveAgentControlGraphTerminalFailure({ state: controlGraph })).toBeUndefined();
    },
  );

  it('rejects blocked completion without requiring an onError callback', () => {
    expect(
      resolveAgentControlGraphTerminalFailure({
        state: state('blocked', 'tool_batch_incomplete'),
      }),
    ).toEqual(
      expect.objectContaining({ message: expect.stringContaining('tool_batch_incomplete') }),
    );
  });

  it('rejects max-iteration finalization even though the graph status is finalized', () => {
    expect(
      resolveAgentControlGraphTerminalFailure({
        state: state('finalized', 'max_iterations'),
      }),
    ).toEqual(expect.objectContaining({ message: expect.stringContaining('max_iterations') }));
  });

  it('rejects a yielded checkpoint because the delegated work remains incomplete', () => {
    expect(
      resolveAgentControlGraphTerminalFailure({
        state: state('yielded', 'tool_yielded'),
      }),
    ).toEqual(expect.objectContaining({ message: expect.stringContaining('tool_yielded') }));
  });

  it('allows a yielded checkpoint only for a foreground run that retains async monitoring', () => {
    expect(
      resolveAgentControlGraphTerminalFailure({
        state: state('yielded', 'tool_yielded'),
        allowYieldedCheckpoint: true,
      }),
    ).toBeUndefined();
  });

  it('preserves the reported terminal error for failed graph completion', () => {
    const error = new Error('provider unavailable');
    expect(
      resolveAgentControlGraphTerminalFailure({
        state: state('failed', 'provider unavailable'),
        reportedError: error,
      }),
    ).toBe(error);
  });

  it('prefers a concrete reported error over a stale successful graph snapshot', () => {
    const error = new Error('transport closed after the candidate was recorded');
    expect(
      resolveAgentControlGraphTerminalFailure({
        state: state('awaiting_review'),
        reportedError: error,
      }),
    ).toBe(error);
  });

  it('tracks callback state and throws the resolved terminal failure', () => {
    const tracker = createAgentControlGraphTerminalOutcomeTracker();
    tracker.recordControlGraphState(state('blocked', 'loop_detected'));

    expect(tracker.resolveFailure()).toEqual(
      expect.objectContaining({ message: expect.stringContaining('loop_detected') }),
    );
    expect(tracker.hasControlGraphFailure()).toBe(true);
    expect(tracker.hasUnsuccessfulTerminalState()).toBe(true);
    expect(() => tracker.throwIfFailed()).toThrow('loop_detected');
  });

  it('lets a later concrete callback error override prior graph state', () => {
    const tracker = createAgentControlGraphTerminalOutcomeTracker();
    const error = new Error('transport closed');
    tracker.recordControlGraphState(state('awaiting_review'));
    tracker.recordError(error);

    expect(tracker.resolveFailure()).toBe(error);
  });

  it.each([
    ['blocked', 'empty_final_text_after_recovery', true],
    ['yielded', 'tool_yielded', true],
    ['finalized', 'max_iterations', true],
    ['failed', 'provider_error', false],
    ['awaiting_review', undefined, false],
  ] as const)(
    'classifies whether %s owns a visible terminal response',
    (status, terminalReason, expected) => {
      expect(isAgentControlGraphFailureResponseState(state(status, terminalReason))).toBe(expected);
    },
  );

  it.each([
    ['loop_detected', 'blocked', 'loop_detected'],
    ['tool_batch_incomplete', 'blocked', 'tool_failure'],
    ['tool_effect_reconciliation_required', 'blocked', 'tool_failure'],
    ['route_blocked', 'blocked', 'route_blocked'],
    ['workflow_route_blocked', 'blocked', 'terminal_blocked'],
    ['the tool route is unavailable', 'blocked', 'terminal_blocked'],
    ['مسار الأداة غير متاح', 'blocked', 'terminal_blocked'],
    ['missing_required_side_effect', 'blocked', 'missing_required_side_effect'],
    ['empty_final_text_after_recovery', 'blocked', 'terminal_blocked'],
    ['max_iterations', 'finalized', 'terminal_blocked'],
  ] as const)('maps raw reason %s to %s', (rawReason, status, expectedReason) => {
    expect(classifyAgentControlGraphTerminalReason(state(status, rawReason))).toBe(expectedReason);
  });
});
