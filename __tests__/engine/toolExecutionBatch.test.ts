import { executeToolExecutionBatch } from '../../src/engine/toolExecution/toolExecutionBatch';

describe('toolExecutionBatch', () => {
  it('advances previewCompletedToolNames after each sequential outcome', async () => {
    const seenContexts: Array<{ completedToolNames: string[] }> = [];

    const outcomes = await executeToolExecutionBatch({
      executableToolCalls: ['calendar_list', 'calendar_events'],
      executeBatchInParallel: false,
      executePendingToolCall: async (toolCall, index, context) => {
        seenContexts.push({
          completedToolNames: Array.from(context.previewCompletedToolNames),
        });
        return { index, toolCall };
      },
      buildUnexpectedExecutionFailureOutcome: (toolCall, index, error) => ({
        index,
        toolCall,
        error,
      }),
      getYieldedMessage: () => undefined,
      getCompletedToolName: (outcome) => String(outcome.toolCall),
      initialCompletedToolNames: new Set<string>(),
    });

    expect(outcomes).toHaveLength(2);
    expect(seenContexts).toEqual([
      { completedToolNames: [] },
      { completedToolNames: ['calendar_list'] },
    ]);
  });
});