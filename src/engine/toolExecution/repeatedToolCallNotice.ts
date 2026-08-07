import { hashResult, type ToolCallRecord } from '../loopDetection';

/**
 * A repeated identical call is only worth flagging once it is clearly not exploration.
 * The first repeat is ordinary — a model re-reading a file it just wrote is doing the
 * right thing. From the third identical call onward the pattern is re-execution.
 */
const IDENTICAL_CALL_NOTICE_THRESHOLD = 3;

function argumentsFingerprint(record: Pick<ToolCallRecord, 'arguments' | 'argsHash'>): string {
  return record.argsHash ?? hashResult(record.arguments) ?? record.arguments;
}

/**
 * Notice appended to a tool result that repeats an earlier call verbatim.
 *
 * Traced live: one run issued the same `read_file` twelve times, every call
 * returning successfully with byte-identical content. Nothing in the transcript
 * distinguished the twelfth result from the first, so re-running the call stayed the
 * model's cheapest move.
 *
 * This states the fact and nothing more. It does not serve a cached result: a repeated
 * read after an intervening write must still re-execute, which is exactly why the
 * result-changed distinction is reported rather than assumed. Deciding what to do next
 * stays with the model; the run only stops being silent about it.
 */
export function buildRepeatedToolCallNotice(params: {
  toolName: string;
  argumentsText: string;
  resultText: string | undefined;
  history: ReadonlyArray<ToolCallRecord>;
}): string | undefined {
  const fingerprint = argumentsFingerprint({ arguments: params.argumentsText });
  const priorIdenticalCalls = params.history.filter(
    (record) => record.name === params.toolName && argumentsFingerprint(record) === fingerprint,
  );
  const callOrdinal = priorIdenticalCalls.length + 1;
  if (callOrdinal < IDENTICAL_CALL_NOTICE_THRESHOLD) {
    return undefined;
  }

  const currentResultHash = hashResult(params.resultText);
  const lastPriorResultHash = priorIdenticalCalls[priorIdenticalCalls.length - 1]?.resultHash;
  const resultUnchanged =
    currentResultHash !== undefined && currentResultHash === lastPriorResultHash;

  return resultUnchanged
    ? `[run notice] This is call ${callOrdinal} to \`${params.toolName}\` with identical ` +
        `arguments in this run, and the result is byte-for-byte identical to the previous one. ` +
        `Calling it again will return the same thing. If work still appears unfinished, the ` +
        `blocker is elsewhere — check which success criteria remain unmet.`
    : `[run notice] This is call ${callOrdinal} to \`${params.toolName}\` with identical ` +
        `arguments in this run. The result differs from the previous one, so the underlying ` +
        `state is changing between calls.`;
}
