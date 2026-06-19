import { buildAgentControlGraphLoopRecoveryDecision } from '../../src/engine/graph/loopRecovery';
import { createGoal } from '../../src/engine/goals/types';
import type { LoopDetectionResult } from '../../src/engine/loopDetection';

function warningLoop(overrides: Partial<LoopDetectionResult> = {}): LoopDetectionResult {
  return {
    loopDetected: true,
    level: 'warning',
    type: 'generic_repeat',
    details: 'Repeated identical tool call.',
    ...overrides,
  };
}

describe('agent control graph loop recovery', () => {
  it('resets warning state when no loop is present', () => {
    expect(
      buildAgentControlGraphLoopRecoveryDecision({
        loopCheck: { loopDetected: false },
        warningAlreadyInjected: true,
        iteration: 4,
        maxIterations: 25,
      }),
    ).toEqual({
      type: 'none',
      shouldResetWarningState: true,
    });
  });

  it('keeps loop warnings as prompt guidance only', () => {
    const decision = buildAgentControlGraphLoopRecoveryDecision({
      loopCheck: warningLoop(),
      warningAlreadyInjected: true,
      iteration: 8,
      maxIterations: 40,
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'warning',
        nextWarningState: true,
      }),
    );
    expect(decision.type === 'warning' ? decision.directive : undefined).toBeUndefined();
    expect(decision.type === 'warning' ? decision.warningMessage : '').toContain(
      'Do not repeat the same tool call with the same input',
    );
  });

  it('blocks the run when a critical loop is detected', () => {
    const decision = buildAgentControlGraphLoopRecoveryDecision({
      loopCheck: {
        loopDetected: true,
        level: 'critical',
        type: 'generic_repeat',
        details: 'CRITICAL: read_file repeated 6 times with identical input.',
        count: 6,
      },
      warningAlreadyInjected: false,
      iteration: 10,
      maxIterations: 25,
    });

    expect(decision).toEqual({
      type: 'block',
      graphEvent: {
        type: 'BLOCKED',
        reason: 'loop_detected',
      },
      details: 'CRITICAL: read_file repeated 6 times with identical input.',
    });
  });

  it('includes machine-readable goal mutation validation codes in recovery hints', () => {
    const decision = buildAgentControlGraphLoopRecoveryDecision({
      loopCheck: warningLoop({ type: 'goal_mutation_stall' }),
      warningAlreadyInjected: false,
      iteration: 3,
      maxIterations: 25,
      toolCallHistory: [
        {
          name: 'update_goals',
          arguments: '{}',
          timestamp: Date.now(),
          result: JSON.stringify({
            status: 'error',
            action: 'activate',
            structuredErrors: [{ code: 'goal_not_found', message: 'missing goal' }],
          }),
        },
      ],
    });

    expect(decision.type).toBe('warning');
    if (decision.type === 'warning') {
      expect(decision.warningMessage).toContain('goal_not_found');
      expect(decision.warningMessage).toContain('"id":"stable-id"');
      expect(decision.warningMessage).toContain('"name":"visible name"');
    }
  });

  it('uses stagnant-progress recovery wording when goal state does not advance', () => {
    const decision = buildAgentControlGraphLoopRecoveryDecision({
      loopCheck: warningLoop({ type: 'stagnant_progress' }),
      warningAlreadyInjected: false,
      iteration: 5,
      maxIterations: 25,
    });

    expect(decision.type).toBe('warning');
    expect(decision.type === 'warning' ? decision.warningMessage : '').toContain(
      'Goal state did not advance',
    );
  });

  it('uses bootstrap-specific recovery wording when goals never materialize', () => {
    const decision = buildAgentControlGraphLoopRecoveryDecision({
      loopCheck: warningLoop({ type: 'bootstrap_stall' }),
      warningAlreadyInjected: false,
      iteration: 3,
      maxIterations: 25,
    });

    expect(decision.type).toBe('warning');
    expect(decision.type === 'warning' ? decision.warningMessage : '').toContain(
      'Goal bootstrap did not advance',
    );
  });

  it('uses error-specific recovery wording for repeated failures', () => {
    const decision = buildAgentControlGraphLoopRecoveryDecision({
      loopCheck: warningLoop({ type: 'repeated_error' }),
      warningAlreadyInjected: true,
      iteration: 9,
      maxIterations: 25,
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'warning',
      }),
    );
    expect(decision.type === 'warning' ? decision.directive : undefined).toBeUndefined();
    expect(decision.type === 'warning' ? decision.warningMessage : '').toContain(
      'Do not repeat the same failing tool call',
    );
  });

  it('includes structured tool repair hints in repeated-error recovery wording', () => {
    const decision = buildAgentControlGraphLoopRecoveryDecision({
      loopCheck: warningLoop({ type: 'repeated_error' }),
      warningAlreadyInjected: true,
      iteration: 9,
      maxIterations: 25,
      goals: [
        createGoal({
          id: 'calendar-goal',
          title: 'Calendar mutation',
          description: 'Create a calendar event titled E2E Native Review, then update it.',
          status: 'active',
          successCriteria: ['evidence.tool:calendar_create_event'],
          completionPolicy: 'blocking',
          now: 1,
        }),
      ],
      toolCallHistory: [
        {
          name: 'calendar_create_event',
          arguments: '{"startDate":"2026-06-14T09:00:00","endDate":"2026-06-14T10:00:00"}',
          timestamp: Date.now(),
          result: JSON.stringify({
            status: 'error',
            code: 'missing_required_argument',
            repair: {
              retryable: true,
              code: 'missing_required_argument',
              missingFields: ['title'],
              expectedShape: {
                arguments: {
                  title: { type: 'string' },
                  startDate: { type: 'string' },
                  endDate: { type: 'string' },
                },
              },
            },
          }),
        },
      ],
    });

    expect(decision.type).toBe('warning');
    expect(decision.type === 'warning' ? decision.warningMessage : '').toContain(
      'calendar_create_event: missing_required_argument fields title',
    );
    expect(decision.type === 'warning' ? decision.warningMessage : '').toContain(
      'Active task focus: [calendar-goal] Calendar mutation: Create a calendar event titled E2E Native Review, then update it.',
    );
    expect(decision.type === 'warning' ? decision.warningMessage : '').toContain(
      'retry the failed tool with corrected top-level arguments',
    );
    expect(decision.type === 'warning' ? decision.warningMessage : '').toContain(
      'user request, graph goals, or prior tool outputs',
    );
  });
});
