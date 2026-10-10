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
function createPendingOperation(
  overrides: Partial<TrackedAsyncOperation> = {},
): TrackedAsyncOperation {
  return {
    key: 'session:worker-1',
    kind: 'session',
    resourceId: 'worker-1',
    displayName: 'Worker 1',
    status: 'running',
    lastUpdatedByTool: 'sessions_spawn',
    updatedAt: 1000,
    monitorToolNames: ['sessions_wait'],
    waitToolName: 'sessions_wait',
    waitArgs: { sessionId: 'worker-1' },
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
  it('holds for pending async work before goals or delivery checks', () => {
    const pendingOperation = createPendingOperation();
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [createGoal({ status: 'active' })],
      trackedOperations: new Map([[pendingOperation.key, pendingOperation]]),
      pendingOperations: [pendingOperation],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'async_waiting_finalization_hold',
      }),
    );
  });
  it('holds finalization on a structural partial read_file result with the exact next offset', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set(['read_file']),
      toolCallHistory: [
        {
          id: 'read-1',
          name: 'read_file',
          arguments: '{"path":"attachments/report.txt","offset":7000}',
          timestamp: 1,
          status: 'completed',
          result: JSON.stringify({
            status: 'read_chunk',
            path: 'attachments/report.txt',
            content: 'partial',
            offset: 7_000,
            nextOffset: 14_000,
            totalChars: 21_000,
            complete: false,
          }),
        },
      ],
    });

    expect(decision).toMatchObject({
      type: 'hold',
      reason: 'incomplete_tool_continuation',
      graphEvent: { type: 'FINALIZATION_HELD', reason: 'incomplete_tool_continuation' },
    });
    if (decision.type === 'hold') {
      expect(decision.systemPrompts.join('\n')).toContain('attachments/report.txt');
      expect(decision.systemPrompts.join('\n')).toContain('offset 14000');
    }
  });
  it('allows finalization after the structural read_file result reaches end of file', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set(['read_file']),
      toolCallHistory: [
        {
          id: 'read-2',
          name: 'read_file',
          arguments: '{"path":"attachments/report.txt","offset":14000}',
          timestamp: 2,
          status: 'completed',
          result: JSON.stringify({
            status: 'read_chunk',
            path: 'attachments/report.txt',
            content: 'final',
            offset: 14_000,
            nextOffset: null,
            totalChars: 21_000,
            complete: true,
          }),
        },
      ],
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('holds finalization when a durable checkpoint omitted even a final chunk body', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set(['read_file']),
      toolCallHistory: [
        {
          id: 'read-checkpoint-1',
          name: 'read_file',
          arguments: '{"path":"attachments/report.txt","offset":14000}',
          timestamp: 3,
          status: 'completed',
          result: JSON.stringify({
            status: 'read_chunk',
            path: 'attachments/report.txt',
            content: '[omitted]',
            offset: 14_000,
            nextOffset: null,
            totalChars: 21_000,
            complete: true,
            durableCheckpoint: {
              version: 1,
              contentRetained: false,
              rereadOffset: 14_000,
            },
          }),
        },
      ],
    });

    expect(decision).toMatchObject({
      type: 'hold',
      reason: 'incomplete_tool_continuation',
    });
    if (decision.type === 'hold') {
      expect(decision.systemPrompts.join('\n')).toContain('offset 14000');
      expect(decision.systemPrompts.join('\n')).toContain('omitted the chunk body');
    }
  });
  it('does not hold for default persistent active goals that lack success criteria', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME]),
      goals: [createGoal({ status: 'active' })],
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('ignores persistent goals with unmet criteria in completion gating', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [
        createGoal({
          status: 'active',
          completionPolicy: 'persistent',
          successCriteria: ['evidence.min:2'],
          evidence: ['read_file:content'],
        }),
      ],
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('skips goal holds when tool recovery cannot run this turn', () => {
    const goals = [createGoal({ status: 'active' })];

    expect(
      evaluateCompletionGate({
        ...buildBaseParams(),
        goals,
        toolingEnabledForProvider: false,
      }),
    ).toEqual({ type: 'ready' });
    expect(
      evaluateCompletionGate({
        ...buildBaseParams(),
        goals,
        forceTextThisTurn: true,
      }),
    ).toEqual({ type: 'ready' });
  });
  it('continues incomplete final text when goals are complete', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [createGoal({ status: 'completed' })],
      fullContent: 'partial final answer',
      completion: {
        completionStatus: 'incomplete',
        finishReason: 'length',
      },
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'incomplete_delivery_continuation',
      }),
    );
    expect(decision.type === 'hold' ? decision.turnDirectives : undefined).toEqual(
      expect.objectContaining({
        forceFinalText: true,
        forcedTextReason: 'incomplete_delivery_continuation',
        incompleteFinalTextRecoveryCount: 1,
      }),
    );
  });
  it('does not hold for graph mutation errors after a later successful graph mutation', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      toolCallHistory: [
        {
          id: 'tc-failed-goals',
          name: GOAL_BOOTSTRAP_TOOL_NAME,
          arguments: '{"action":"complete","id":"missing"}',
          timestamp: 1,
          status: 'failed',
          result: JSON.stringify({ status: 'error' }),
        },
        {
          id: 'tc-ok-goals',
          name: GOAL_BOOTSTRAP_TOOL_NAME,
          arguments: '{"action":"add","id":"scope","name":"Scope"}',
          timestamp: 2,
          status: 'completed',
          result: JSON.stringify({ status: 'ok' }),
        },
      ],
    });

    expect(decision).toEqual({ type: 'ready' });
  });
});
