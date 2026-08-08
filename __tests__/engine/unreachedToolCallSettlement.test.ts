import { executeToolExecutionBatch } from '../../src/engine/toolExecution/toolExecutionBatch';

// Traced live on an Android emulator. A batch yielded on a blocking `sessions_send`, and
// the `tool_catalog` call behind it was abandoned — no outcome, no result message, nothing
// to settle the row the model had already been shown. It sat at "Waiting" for nearly four
// minutes while the model, never receiving a result, gave up on the capability it was
// trying to discover. The run failed with the call still open, and finalization could only
// report it afterwards as never having completed.

type Call = { id: string; name: string };
type Outcome = {
  index: number;
  toolCallId: string;
  content: string;
  yieldedMessage?: string;
  deferred?: boolean;
};

function runBatch(params: {
  calls: Call[];
  executeBatchInParallel?: boolean;
  onExecute: (call: Call, index: number) => Outcome;
  shouldStopAfterOutcome?: () => boolean;
}) {
  const executed: string[] = [];
  return {
    executed,
    result: executeToolExecutionBatch<Call, Outcome>({
      executableToolCalls: params.calls,
      executeBatchInParallel: params.executeBatchInParallel === true,
      executePendingToolCall: async (call, index) => {
        executed.push(call.name);
        return params.onExecute(call, index);
      },
      buildUnexpectedExecutionFailureOutcome: (call, index) => ({
        index,
        toolCallId: call.id,
        content: 'unexpected',
      }),
      buildSkippedExecutionOutcome: (call, index, reason) => ({
        index,
        toolCallId: call.id,
        content: `skipped:${reason}`,
      }),
      initialCompletedToolNames: new Set<string>(),
      getYieldedMessage: (outcome) => outcome.yieldedMessage,
      shouldSuspendAfterOutcome: (outcome) => outcome.deferred === true,
      ...(params.shouldStopAfterOutcome
        ? { shouldStopAfterOutcome: params.shouldStopAfterOutcome }
        : {}),
    }),
  };
}

const call = (name: string): Call => ({ id: `tc-${name}`, name });

describe('a batch that stops early still settles every call it never reached', () => {
  it('settles calls behind one that yielded', async () => {
    const { executed, result } = runBatch({
      calls: [call('sessions_send'), call('tool_catalog'), call('read_file')],
      onExecute: (candidate, index) => ({
        index,
        toolCallId: candidate.id,
        content: 'ok',
        ...(candidate.name === 'sessions_send'
          ? { yieldedMessage: 'Waiting for background agent results.' }
          : {}),
      }),
    });
    const outcomes = await result;

    expect(executed).toEqual(['sessions_send']);
    // One outcome per call the model made — nothing left pending.
    expect(outcomes).toHaveLength(3);
    expect(outcomes[1]?.content).toBe('skipped:batch_suspended');
    expect(outcomes[2]?.content).toBe('skipped:batch_suspended');
  });

  it('settles calls behind one that suspended for a deferred handoff', async () => {
    const { result } = runBatch({
      calls: [call('mobile_ui_action'), call('tool_catalog')],
      onExecute: (candidate, index) => ({
        index,
        toolCallId: candidate.id,
        content: 'ok',
        ...(candidate.name === 'mobile_ui_action' ? { deferred: true } : {}),
      }),
    });
    const outcomes = await result;

    expect(outcomes).toHaveLength(2);
    expect(outcomes[1]?.content).toBe('skipped:batch_suspended');
  });

  it('keeps the loop-detection reason distinct from a suspension', async () => {
    let stop = false;
    const { result } = runBatch({
      calls: [call('read_file'), call('write_file')],
      onExecute: (candidate, index) => {
        stop = true;
        return { index, toolCallId: candidate.id, content: 'ok' };
      },
      shouldStopAfterOutcome: () => stop,
    });
    const outcomes = await result;

    expect(outcomes[1]?.content).toBe('skipped:critical_loop_detected');
  });

  it('leaves an ordinary batch untouched', async () => {
    const { executed, result } = runBatch({
      calls: [call('read_file'), call('write_file')],
      onExecute: (candidate, index) => ({ index, toolCallId: candidate.id, content: 'ok' }),
    });
    const outcomes = await result;

    expect(executed).toEqual(['read_file', 'write_file']);
    expect(outcomes.map((outcome) => outcome.content)).toEqual(['ok', 'ok']);
  });

  it('returns one outcome per call when the batch runs in parallel', async () => {
    const { result } = runBatch({
      calls: [call('read_file'), call('list_files')],
      executeBatchInParallel: true,
      onExecute: (candidate, index) => ({ index, toolCallId: candidate.id, content: 'ok' }),
    });

    await expect(result).resolves.toHaveLength(2);
  });
});
