import { GOAL_BOOTSTRAP_TOOL_NAME } from '../../src/engine/goals/bootstrap';
import { evaluateCompletionGate } from '../../src/engine/graph/completionGate';
import type { AgentControlTurnDirectives } from '../../src/engine/graph/agentControlGraph';
import type { AgentGoal } from '../../src/types/agentRun';
import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';
const baseTurnDirectives: AgentControlTurnDirectives = {
  forceFinalText: false,
  requireWorkflowTool: false,
  incompleteFinalTextRecoveryCount: 0,
};
function createGoal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    id: 'g1',
    title: 'Build feature',
    status: 'pending',
    dependencies: [],
    evidence: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}
function buildBaseParams() {
  return {
    trackedOperations: new Map<string, TrackedAsyncOperation>(),
    pendingOperations: [] as TrackedAsyncOperation[],
    consecutivePendingAsyncNoToolTurns: 0,
    hasDraftContent: true,
    goals: [] as AgentGoal[],
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
      goals: [],
      selectedToolNames: new Set(['tool_catalog', 'sms_compose']),
      toolCallHistory: [
        {
          id: 'tc-sms',
          name: 'sms_compose',
          arguments: '{"recipients":["Avery"],"message":"Hello"}',
          timestamp: 1,
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
      goals: [],
      selectedToolNames: new Set(['tool_catalog', 'sms_compose']),
      toolCallHistory: [
        {
          id: 'tc-sms',
          name: 'sms_compose',
          arguments: '{"recipients":["Avery"],"message":"Hello"}',
          timestamp: 1,
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
  it('holds for bounded workflow continuation when downstream tools remain', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set(['calendar_create_event', 'calendar_update_event']),
      pendingWorkflowContinuationToolNames: ['calendar_update_event'],
      toolCallHistory: [
        {
          id: 'tc-calendar-create',
          name: 'calendar_create_event',
          arguments: '{"title":"Review"}',
          timestamp: 1,
          result: JSON.stringify({ status: 'created', eventId: 'evt-1' }),
        },
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'workflow_continuation',
        graphEvent: {
          type: 'FINALIZATION_HELD',
          reason: 'workflow_continuation',
        },
        nextConsecutivePendingAsyncNoToolTurns: 1,
      }),
    );
    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain('downstream workflow tools');
    expect(prompt).toContain('calendar_update_event');
  });
  it('bounds workflow continuation after the second no-tool recovery pass', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      consecutivePendingAsyncNoToolTurns: 2,
      goals: [],
      selectedToolNames: new Set(['calendar_create_event', 'calendar_update_event']),
      pendingWorkflowContinuationToolNames: ['calendar_update_event'],
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('holds once for substantial no-tool prose when discovery tools are available', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set(['tool_catalog', 'memory_recall']),
      toolCallHistory: [],
      fullContent:
        'I can verify this by checking the available device state and then recording the result. ' +
        'The answer depends on state outside the visible transcript, so I should not treat this as complete prose.',
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'no_tool_progress_retry',
        graphEvent: {
          type: 'FINALIZATION_HELD',
          reason: 'no_tool_progress_retry',
        },
        nextConsecutivePendingAsyncNoToolTurns: 1,
      }),
    );
  });
  it('does not hold short direct no-tool answers for discovery retry', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set(['tool_catalog', 'memory_recall']),
      toolCallHistory: [],
      fullContent: 'No problem.',
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('holds once to reconcile successful external tool evidence into graph state', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'calendar_list', 'memory_remember']),
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
          name: 'memory_remember',
          arguments: '{"predicate":"calendar_modifiable"}',
          timestamp: 2,
          result: JSON.stringify({ status: 'remembered' }),
        },
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'graph_state_reconciliation',
        graphEvent: {
          type: 'FINALIZATION_HELD',
          reason: 'graph_state_reconciliation',
        },
        nextConsecutivePendingAsyncNoToolTurns: 1,
      }),
    );
    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain('control graph has no recorded goal state');
    expect(prompt).toContain('call update_goals');
  });
  it('does not repeat graph reconciliation after the bounded retry pass', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      consecutivePendingAsyncNoToolTurns: 1,
      goals: [],
      selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'calendar_list', 'memory_remember']),
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
          name: 'memory_remember',
          arguments: '{"predicate":"calendar_modifiable"}',
          timestamp: 2,
          result: JSON.stringify({ status: 'remembered' }),
        },
      ],
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('does not reconcile graph state for failed, graph-only, or single work-tool history', () => {
    expect(
      evaluateCompletionGate({
        ...buildBaseParams(),
        goals: [],
        selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'calendar_list']),
        toolCallHistory: [
          {
            id: 'tc-catalog',
            name: 'tool_catalog',
            arguments: '{}',
            timestamp: 1,
            result: JSON.stringify({ status: 'ok' }),
          },
          {
            id: 'tc-calendar',
            name: 'calendar_list',
            arguments: '{}',
            timestamp: 2,
            result: JSON.stringify([{ id: 'default', allowsModifications: true }]),
          },
        ],
      }),
    ).toEqual({ type: 'ready' });

    expect(
      evaluateCompletionGate({
        ...buildBaseParams(),
        goals: [],
        selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'calendar_list']),
        toolCallHistory: [
          {
            id: 'tc-calendar',
            name: 'calendar_list',
            arguments: '{}',
            timestamp: 1,
            result: 'Error: calendar unavailable',
          },
        ],
      }),
    ).toEqual({ type: 'ready' });

    expect(
      evaluateCompletionGate({
        ...buildBaseParams(),
        goals: [],
        selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME]),
        toolCallHistory: [
          {
            id: 'tc-goals',
            name: GOAL_BOOTSTRAP_TOOL_NAME,
            arguments: '{"action":"add","id":"g1"}',
            timestamp: 1,
            result: JSON.stringify({ status: 'ok' }),
          },
        ],
      }),
    ).toEqual({ type: 'ready' });
  });
  it('holds when evidence.tool criteria are unmet', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [
        createGoal({
          status: 'active',
          successCriteria: ['evidence.tool:write_file'],
          evidence: ['read_file:config.json'],
        }),
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'goal_evidence_incomplete',
        missingRequiredEvidenceLabels: ['g1:evidence.tool:write_file'],
      }),
    );
  });
  it('keeps missing evidence as a continuation condition in hold prompts', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [
        createGoal({
          status: 'active',
          successCriteria: ['evidence.tool:write_file'],
          evidence: [],
        }),
      ],
    });

    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain('Missing evidence criteria: g1:evidence.tool:write_file');
    expect(prompt).toContain('Continue executing until required goal evidence is recorded');
    expect(prompt).not.toContain('blockedReason');
  });
  it('returns ready when no blockers remain', () => {
    expect(
      evaluateCompletionGate({
        ...buildBaseParams(),
        goals: [createGoal({ status: 'completed' })],
      }),
    ).toEqual({ type: 'ready' });
  });
});
