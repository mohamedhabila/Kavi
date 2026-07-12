import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { consumeAgentRunAutomaticRecoveryAttempt } from '../../src/engine/graph/foregroundRun/automaticRecoveryBudget';

describe('agent-run automatic recovery budget', () => {
  it('persists exactly one automatic recovery attempt across graph resume', () => {
    const failed = createInitialAgentControlGraphSnapshot({
      status: 'failed',
      terminalReason: 'provider interrupted',
      updatedAt: 1,
    });

    const first = consumeAgentRunAutomaticRecoveryAttempt({
      controlGraph: failed,
      reason: 'recover final delivery',
      timestamp: 2,
    });
    expect(first).toMatchObject({
      type: 'consumed',
      controlGraph: {
        status: 'ready',
        turnDirectives: { automaticRecoveryAttemptCount: 1 },
      },
    });
    if (first.type !== 'consumed') throw new Error('Expected recovery attempt to be consumed.');

    expect(
      consumeAgentRunAutomaticRecoveryAttempt({
        controlGraph: first.controlGraph,
        reason: 'recover final delivery again',
        timestamp: 3,
      }),
    ).toEqual({ type: 'exhausted' });
  });

  it('does not reset an unsafe in-flight model boundary to spend the budget', () => {
    expect(
      consumeAgentRunAutomaticRecoveryAttempt({
        controlGraph: createInitialAgentControlGraphSnapshot({ status: 'model_turn' }),
        reason: 'unsafe retry',
        timestamp: 2,
      }),
    ).toEqual({ type: 'unavailable' });
  });
});
