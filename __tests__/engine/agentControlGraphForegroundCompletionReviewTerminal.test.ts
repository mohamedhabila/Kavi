import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { buildAgentControlGraphTerminalReviewCompletion } from '../../src/engine/graph/foregroundRun/completionReviewTerminal';

describe('foreground graph terminal review completion', () => {
  it.each([
    ['loop_detected', 'loop_detected'],
    ['tool_batch_incomplete', 'tool_failure'],
    ['workflow_route_blocked', 'route_blocked'],
    ['missing_required_side_effect', 'missing_required_side_effect'],
    ['empty_final_text_after_recovery', 'terminal_blocked'],
  ] as const)('retains blocked reason %s under %s', (rawReason, terminalReason) => {
    const completion = buildAgentControlGraphTerminalReviewCompletion(
      createInitialAgentControlGraphSnapshot({
        status: 'blocked',
        terminalReason: rawReason,
      }),
    );

    expect(completion).toEqual(
      expect.objectContaining({
        status: 'failed',
        terminalReason,
        checkpointDetail: expect.stringContaining(rawReason),
      }),
    );
  });

  it('classifies max-iteration finalization as an incomplete failed run', () => {
    expect(
      buildAgentControlGraphTerminalReviewCompletion(
        createInitialAgentControlGraphSnapshot({
          status: 'finalized',
          terminalReason: 'max_iterations',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        status: 'failed',
        terminalReason: 'terminal_blocked',
        checkpointDetail: expect.stringContaining('max_iterations'),
      }),
    );
  });

  it.each([
    ['awaiting_review', undefined],
    ['yielded', 'tool_yielded'],
    ['finalized', 'completed'],
  ] as const)('defers non-failing %s completion to its normal closeout', (status, terminalReason) => {
    expect(
      buildAgentControlGraphTerminalReviewCompletion(
        createInitialAgentControlGraphSnapshot({ status, terminalReason }),
      ),
    ).toBeUndefined();
  });
});
