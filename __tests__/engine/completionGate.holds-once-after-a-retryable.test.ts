import { evaluateCompletionGate } from '../../src/engine/graph/completionGate';
import type { AgentControlTurnDirectives } from '../../src/engine/graph/agentControlGraph';
import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';

const baseTurnDirectives: AgentControlTurnDirectives = {
  forceFinalText: false,
  requireWorkflowTool: false,
  incompleteFinalTextRecoveryCount: 0,
};
function buildBaseParams() {
  return {
    trackedOperations: new Map<string, TrackedAsyncOperation>(),
    pendingOperations: [] as TrackedAsyncOperation[],
    consecutivePendingAsyncNoToolTurns: 0,
    hasDraftContent: true,
    toolingEnabledForProvider: true,
    selectedToolCount: 2,
    forceTextThisTurn: false,
    fullContent: 'final answer',
    recoveryDirectives: baseTurnDirectives,
    completion: {
      completionStatus: 'complete' as const,
      finishReason: 'stop',
    },
    nextFinalizationMaxTokens: 4096,
  };
}

describe('completionGate', () => {
  it('holds once after a retryable non-graph tool error', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set(['tool_catalog', 'sms_compose']),
      toolCallHistory: [
        {
          id: 'tc-sms',
          name: 'sms_compose',
          arguments: '{"recipients":["Avery"],"message":"Hello"}',
          timestamp: 1,
          status: 'failed',
          result: JSON.stringify({
            status: 'error',
            code: 'invalid_phone_number',
            repair: {
              retryable: true,
              code: 'invalid_phone_number',
              invalidFields: ['recipients'],
            },
          }),
        },
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'tool_error_repair',
        graphEvent: {
          type: 'FINALIZATION_HELD',
          reason: 'tool_error_repair',
        },
        nextConsecutivePendingAsyncNoToolTurns: 1,
      }),
    );
    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain('latest tool call failed');
    expect(prompt).toContain('sms_compose: invalid_phone_number fields recipients');
    expect(prompt).toContain('discovery tools');
  });
  it('does not repeatedly hold after the bounded retryable tool-error repair pass', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      consecutivePendingAsyncNoToolTurns: 1,
      selectedToolNames: new Set(['tool_catalog', 'sms_compose']),
      toolCallHistory: [
        {
          id: 'tc-sms',
          name: 'sms_compose',
          arguments: '{"recipients":["Avery"],"message":"Hello"}',
          timestamp: 1,
          status: 'failed',
          result: JSON.stringify({
            status: 'error',
            code: 'invalid_phone_number',
            repair: {
              retryable: true,
              code: 'invalid_phone_number',
              invalidFields: ['recipients'],
            },
          }),
        },
      ],
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('finalizes the first tool-free agentic candidate instead of generating it twice', () => {
    // Regression: every answer-only first turn in agentic mode was held once and
    // regenerated. Measured on 10 live holds (z-ai/glm-5.3-flash, 2026-10-09), 8 second
    // passes returned the same kind of text answer; the guidance the hold repeated is
    // already in the runtime prompt the first pass receives.
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set(['request_clarification', 'tool_catalog', 'memory_recall']),
      toolCallHistory: [],
      fullContent: 'The visible context is sufficient.',
    });

    expect(decision).toEqual({ type: 'ready' });
  });

  it('does not hold a tool-free answer when no tool work is outstanding', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set(['tool_catalog', 'memory_recall']),
      toolCallHistory: [],
      fullContent: 'No problem.',
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('allows finalization after multiple successful read-only results', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set(['update_plan', 'calendar_list', 'memory_recall']),
      toolCallHistory: [
        {
          id: 'tc-calendar',
          name: 'calendar_list',
          arguments: '{}',
          timestamp: 1,
          result: JSON.stringify([{ id: 'default', allowsModifications: true }]),
        },
        {
          id: 'tc-memory',
          name: 'memory_recall',
          arguments: '{"query":"calendar preferences"}',
          timestamp: 2,
          result: JSON.stringify({ facts: [] }),
        },
      ],
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('returns ready when no blockers remain', () => {
    expect(
      evaluateCompletionGate({
        ...buildBaseParams(),
      }),
    ).toEqual({ type: 'ready' });
  });
});
