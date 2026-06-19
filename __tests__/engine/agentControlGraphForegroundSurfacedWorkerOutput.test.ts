import {
  buildForegroundSurfacedWorkerFlushEffect,
  buildForegroundSurfacedWorkerToolMessageEffect,
  syncForegroundSurfacedWorkerOutputCompletion,
} from '../../src/engine/graph/foregroundRun/surfacedWorkerOutput';
import type { ToolCall } from '../../src/types/message';

function createSurfaceToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tc-surface',
    name: 'sessions_surface_output',
    arguments: '{"sessionId":"sub-surface"}',
    status: 'completed',
    result: JSON.stringify({
      status: 'surfaced',
      sessionId: 'sub-surface',
      output: 'Worker-authored final answer',
      outputLength: 26,
      sourceOutputLength: 26,
      selectionApplied: false,
      usedFullOutput: true,
      guidance:
        'This output is intended to be surfaced directly to the user by the runtime. Do not restate the same content in assistant text unless you are adding materially new information.',
    }),
    ...overrides,
  };
}

describe('foreground surfaced worker output', () => {
  it('queues completed surfaced worker output for follow-up delivery', () => {
    const pendingOutputs = new Map();

    const surfacedOutput = syncForegroundSurfacedWorkerOutputCompletion({
      pendingOutputs,
      toolCall: createSurfaceToolCall(),
    });

    expect(surfacedOutput).toEqual(
      expect.objectContaining({
        sessionId: 'sub-surface',
        output: 'Worker-authored final answer',
      }),
    );
    expect(pendingOutputs.get('tc-surface')).toEqual(surfacedOutput);
  });

  it('clears invalid surfaced worker output instead of leaving stale pending state', () => {
    const pendingOutputs = new Map([
      [
        'tc-surface',
        {
          status: 'surfaced',
          sessionId: 'sub-surface',
          output: 'old output',
          outputLength: 10,
          sourceOutputLength: 10,
          selectionApplied: false,
          usedFullOutput: true,
          guidance: 'guidance',
        },
      ],
    ]);

    const surfacedOutput = syncForegroundSurfacedWorkerOutputCompletion({
      pendingOutputs,
      toolCall: createSurfaceToolCall({ result: 'not-json' }),
    });

    expect(surfacedOutput).toBeUndefined();
    expect(pendingOutputs.has('tc-surface')).toBe(false);
  });

  it('builds a tool message summary and a follow-up assistant message effect', () => {
    const pendingOutputs = new Map();
    syncForegroundSurfacedWorkerOutputCompletion({
      pendingOutputs,
      toolCall: createSurfaceToolCall(),
    });

    const toolMessageEffect = buildForegroundSurfacedWorkerToolMessageEffect({
      pendingOutputs,
      toolCallId: 'tc-surface',
      rawResult: 'tool result',
    });
    expect(toolMessageEffect.content).toContain(
      'Full worker output from sub-surface was surfaced to the user in the assistant response.',
    );

    const flushEffect = buildForegroundSurfacedWorkerFlushEffect({
      pendingOutputs,
      surfacedMessageId: 'assistant-surfaced-1',
      toolCallId: 'tc-surface',
    });

    expect(flushEffect).toEqual({
      assistantMessage: expect.objectContaining({
        id: 'assistant-surfaced-1',
        role: 'assistant',
        content: 'Worker-authored final answer',
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'surfaced_worker_output_pending',
        }),
      }),
      latestSummary: 'Worker-authored final answer',
      lock: {
        toolCallId: 'tc-surface',
        messageId: 'assistant-surfaced-1',
        content: 'Worker-authored final answer',
      },
    });
    expect(pendingOutputs.has('tc-surface')).toBe(false);
  });
});
