import { evaluateCompletionGate } from '../../src/engine/graph/completionGate';
import type { AgentControlTurnDirectives } from '../../src/engine/graph/agentControlGraph';
import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';
const baseTurnDirectives: AgentControlTurnDirectives = {
  forceFinalText: false,
  requireWorkflowTool: false,
  incompleteFinalTextRecoveryCount: 0,
};
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
  it('holds for pending async work before delivery checks', () => {
    const pendingOperation = createPendingOperation();
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
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
  it('continues incomplete final text', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
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
});
