import {
  AMBIGUOUS_EFFECT_RESTART_ERROR,
  VERIFIED_EFFECT_RESTART_RESULT,
  projectToolCallAfterRestart,
} from '../../src/services/executionJournal/toolEffectRestartProjection';
import type { ToolCall } from '../../src/types/message';

const INTERRUPTED_ERROR = 'Tool execution was interrupted by an app restart.';
const RESTART_AT = 1_700_000_100_000;

function runningToolCall(): ToolCall {
  return {
    id: 'tc-restart',
    name: 'javascript',
    arguments: '{}',
    status: 'running',
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  } as ToolCall;
}

describe('projectToolCallAfterRestart', () => {
  it('surfaces an ambiguous durable dispatch as reconciliation_required, not a generic runtime error', () => {
    const projected = projectToolCallAfterRestart({
      toolCall: runningToolCall(),
      disposition: {
        kind: 'reconciliation_required',
        observedAt: 1_700_000_050_000,
        reason: 'ambiguous_effect',
      },
      timestamp: RESTART_AT,
      interruptedErrorMessage: INTERRUPTED_ERROR,
    });

    expect(projected.recoveredAs).toBe('failed');
    expect(projected.toolCall.status).toBe('failed');
    expect(projected.toolCall.failureKind).toBe('reconciliation_required');
    expect(projected.toolCall.error).toBe(AMBIGUOUS_EFFECT_RESTART_ERROR);
    expect(projected.toolCall.completedAt).toBe(RESTART_AT);
  });

  it('keeps a plain interruption without a durable effect as a runtime error', () => {
    const projected = projectToolCallAfterRestart({
      toolCall: runningToolCall(),
      disposition: { kind: 'not_dispatched' },
      timestamp: RESTART_AT,
      interruptedErrorMessage: INTERRUPTED_ERROR,
    });

    expect(projected.recoveredAs).toBe('failed');
    expect(projected.toolCall.failureKind).toBe('runtime_error');
    expect(projected.toolCall.error).toBe(INTERRUPTED_ERROR);
  });

  it('projects a durably verified effect as completed with no failure kind', () => {
    const projected = projectToolCallAfterRestart({
      toolCall: runningToolCall(),
      disposition: { kind: 'verified', observedAt: 1_700_000_050_000 },
      timestamp: RESTART_AT,
      interruptedErrorMessage: INTERRUPTED_ERROR,
    });

    expect(projected.recoveredAs).toBe('completed');
    expect(projected.toolCall.status).toBe('completed');
    expect(projected.toolCall.failureKind).toBeUndefined();
    expect(projected.toolCall.result).toBe(VERIFIED_EFFECT_RESTART_RESULT);
  });
});
