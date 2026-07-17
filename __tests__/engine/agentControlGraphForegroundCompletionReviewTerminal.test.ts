import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { buildAgentControlGraphTerminalReviewCompletion } from '../../src/engine/graph/foregroundRun/completionReviewTerminal';
import { buildAssistantMessageMetadata } from '../../src/utils/assistantMessageMetadata';

describe('foreground graph terminal review completion', () => {
  it.each([
    ['loop_detected', 'loop_detected'],
    ['tool_batch_incomplete', 'tool_failure'],
    ['workflow_route_blocked', 'terminal_blocked'],
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

  it('preserves a delivered approval-rejection notice as a cancelled run', () => {
    const content =
      'Okay — I did not perform that action because you rejected the approval request. No effect was dispatched.';

    expect(
      buildAgentControlGraphTerminalReviewCompletion(
        createInitialAgentControlGraphSnapshot({
          status: 'cancelled',
          terminalReason: 'user_approval_denied',
        }),
        {
          role: 'assistant',
          content,
          assistantMetadata: buildAssistantMessageMetadata('final', {
            completionStatus: 'complete',
            finishReason: 'user_approval_denied',
          }),
        },
      ),
    ).toEqual({
      status: 'cancelled',
      latestSummary: content,
      checkpointTitle: 'Run cancelled',
      checkpointDetail: content,
      terminalReason: 'user_cancelled',
      logLevel: 'warning',
      logTitle: 'Run cancelled',
      logDetail: content,
    });
  });

  it.each([
    ['awaiting_review', undefined],
    ['yielded', 'tool_yielded'],
    ['finalized', 'completed'],
  ] as const)(
    'defers non-failing %s completion to its normal closeout',
    (status, terminalReason) => {
      expect(
        buildAgentControlGraphTerminalReviewCompletion(
          createInitialAgentControlGraphSnapshot({ status, terminalReason }),
        ),
      ).toBeUndefined();
    },
  );
});
