export interface ToolExecutionBatchExecutionContext {
  previewCompletedToolNames: ReadonlySet<string>;
}

export interface ToolExecutionBatchParams<TToolCall, TOutcome> {
  executableToolCalls: ReadonlyArray<TToolCall>;
  executeBatchInParallel: boolean;
  executePendingToolCall: (
    toolCall: TToolCall,
    index: number,
    context: ToolExecutionBatchExecutionContext,
  ) => Promise<TOutcome>;
  buildUnexpectedExecutionFailureOutcome: (
    toolCall: TToolCall,
    index: number,
    error: unknown,
  ) => TOutcome;
  initialCompletedToolNames: ReadonlySet<string>;
  getYieldedMessage: (outcome: TOutcome) => string | undefined;
  getCompletedToolName?: (outcome: TOutcome) => string | undefined;
  shouldStopAfterOutcome?: (params: {
    outcome: TOutcome;
    index: number;
    outcomes: ReadonlyArray<TOutcome>;
    previewCompletedToolNames: ReadonlySet<string>;
  }) => boolean;
  buildSkippedExecutionOutcome?: (
    toolCall: TToolCall,
    index: number,
    reason: string,
  ) => TOutcome;
}

export async function executeToolExecutionBatch<TToolCall, TOutcome>(
  params: ToolExecutionBatchParams<TToolCall, TOutcome>,
): Promise<TOutcome[]> {
  if (params.executeBatchInParallel) {
    const settled = await Promise.allSettled(
      params.executableToolCalls.map((toolCall, index) =>
        params.executePendingToolCall(toolCall, index, {
          previewCompletedToolNames: params.initialCompletedToolNames,
        }),
      ),
    );
    return settled.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return params.buildUnexpectedExecutionFailureOutcome(
        params.executableToolCalls[index],
        index,
        result.reason,
      );
    });
  }

  const outcomes: TOutcome[] = [];
  let previewCompletedToolNames = new Set(params.initialCompletedToolNames);

  for (let index = 0; index < params.executableToolCalls.length; index += 1) {
    const outcome = await params.executePendingToolCall(
      params.executableToolCalls[index],
      index,
      { previewCompletedToolNames },
    );
    outcomes.push(outcome);

    if (params.getYieldedMessage(outcome)) {
      break;
    }

    const completedToolName = params.getCompletedToolName?.(outcome)?.trim();
    if (completedToolName) {
      previewCompletedToolNames = new Set([...previewCompletedToolNames, completedToolName]);
    }

    if (
      params.shouldStopAfterOutcome?.({
        outcome,
        index,
        outcomes,
        previewCompletedToolNames,
      })
    ) {
      if (params.buildSkippedExecutionOutcome) {
        for (
          let skippedIndex = index + 1;
          skippedIndex < params.executableToolCalls.length;
          skippedIndex += 1
        ) {
          outcomes.push(
            params.buildSkippedExecutionOutcome(
              params.executableToolCalls[skippedIndex],
              skippedIndex,
              'critical_loop_detected',
            ),
          );
        }
      }
      break;
    }
  }

  return outcomes;
}
