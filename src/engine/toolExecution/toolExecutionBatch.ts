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
  shouldSuspendAfterOutcome?: (outcome: TOutcome) => boolean;
  getCompletedToolName?: (outcome: TOutcome) => string | undefined;
  shouldStopAfterOutcome?: (params: {
    outcome: TOutcome;
    index: number;
    outcomes: ReadonlyArray<TOutcome>;
    previewCompletedToolNames: ReadonlySet<string>;
  }) => boolean;
  buildSkippedExecutionOutcome?: (toolCall: TToolCall, index: number, reason: string) => TOutcome;
}

/** Closes out calls a stopped batch never reached, so no rendered call is left pending. */
function settleUnreachedToolCalls<TToolCall, TOutcome>(input: {
  params: ToolExecutionBatchParams<TToolCall, TOutcome>;
  outcomes: TOutcome[];
  fromIndex: number;
  reason: string;
}): void {
  const build = input.params.buildSkippedExecutionOutcome;
  if (!build) {
    return;
  }
  for (
    let index = input.fromIndex;
    index < input.params.executableToolCalls.length;
    index += 1
  ) {
    input.outcomes.push(build(input.params.executableToolCalls[index], index, input.reason));
  }
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
    const outcome = await params.executePendingToolCall(params.executableToolCalls[index], index, {
      previewCompletedToolNames,
    });
    outcomes.push(outcome);

    if (params.shouldSuspendAfterOutcome?.(outcome) || params.getYieldedMessage(outcome)) {
      /**
       * Every call the model made has to end somewhere, including the ones this batch
       * never reaches.
       *
       * Suspending or yielding stops the loop, and the trailing calls used to be simply
       * abandoned — no outcome, no result message, nothing to settle the row the model had
       * already been shown. The loop-detection path below has always closed them out; this
       * path did not, so the difference was invisible until a live run hit it.
       *
       * Traced on-device: a batch yielded on a blocking `sessions_send`, and the
       * `tool_catalog` call behind it sat at "Waiting" for the rest of the run — nearly
       * four minutes and climbing — while the model, never receiving a result, gave up on
       * the capability it had been trying to discover. The run then failed with the call
       * still open, and finalization could only report it after the fact as never having
       * completed. Closing them here means the model learns immediately that the call did
       * not run, and can reissue it on the next turn instead of waiting on it forever.
       */
      settleUnreachedToolCalls({ params, outcomes, fromIndex: index + 1, reason: 'batch_suspended' });
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
      settleUnreachedToolCalls({
        params,
        outcomes,
        fromIndex: index + 1,
        reason: 'critical_loop_detected',
      });
      break;
    }
  }

  return outcomes;
}
