import { buildRepeatedToolCallNotice } from '../../src/engine/toolExecution/repeatedToolCallNotice';
import { hashResult, type ToolCallRecord } from '../../src/engine/loopDetection';

// Traced live on `multi-turn-goal-passive-recall`: the same `read_file` was issued
// twelve times, every call returning successfully with byte-identical content. Nothing
// in the transcript distinguished the twelfth result from the first. This notice is a
// visibility fix for that, not the root-cause fix — the run's actual dead end was a
// goal mutation that could never be accepted, fixed separately.
function record(name: string, args: string, result: string): ToolCallRecord {
  return {
    name,
    arguments: args,
    timestamp: 1,
    status: 'completed',
    result,
    resultHash: hashResult(result),
  };
}

const ARGS = JSON.stringify({ path: 'notes.md' });

describe('repeated tool call notice', () => {
  it('stays silent on the first call', () => {
    expect(
      buildRepeatedToolCallNotice({
        toolName: 'read_file',
        argumentsText: ARGS,
        resultText: 'body',
        history: [],
      }),
    ).toBeUndefined();
  });

  it('stays silent on the first repeat, which is ordinary re-reading', () => {
    expect(
      buildRepeatedToolCallNotice({
        toolName: 'read_file',
        argumentsText: ARGS,
        resultText: 'body',
        history: [record('read_file', ARGS, 'body')],
      }),
    ).toBeUndefined();
  });

  it('reports the ordinal and that the result is unchanged from the third call on', () => {
    const notice = buildRepeatedToolCallNotice({
      toolName: 'read_file',
      argumentsText: ARGS,
      resultText: 'body',
      history: [record('read_file', ARGS, 'body'), record('read_file', ARGS, 'body')],
    });

    expect(notice).toContain('call 3');
    expect(notice).toContain('read_file');
    expect(notice).toContain('identical');
    expect(notice).toContain('success criteria');
  });

  it('says the state is changing when an intervening write altered the result', () => {
    // A repeated read after a write must not be described as pointless, and must never
    // be served from a cache — the underlying file genuinely changed.
    const notice = buildRepeatedToolCallNotice({
      toolName: 'read_file',
      argumentsText: ARGS,
      resultText: 'updated body',
      history: [record('read_file', ARGS, 'body'), record('read_file', ARGS, 'body')],
    });

    expect(notice).toContain('differs from the previous one');
    expect(notice).not.toContain('same thing');
  });

  it('counts only calls with the same name and the same arguments', () => {
    const history = [
      record('read_file', ARGS, 'body'),
      record('read_file', JSON.stringify({ path: 'other.md' }), 'x'),
      record('write_file', ARGS, 'ok'),
    ];

    expect(
      buildRepeatedToolCallNotice({
        toolName: 'read_file',
        argumentsText: ARGS,
        resultText: 'body',
        history,
      }),
    ).toBeUndefined();
  });

  it('keeps counting up so a long spiral reports its true depth', () => {
    const history = Array.from({ length: 11 }, () => record('read_file', ARGS, 'body'));
    const notice = buildRepeatedToolCallNotice({
      toolName: 'read_file',
      argumentsText: ARGS,
      resultText: 'body',
      history,
    });

    expect(notice).toContain('call 12');
  });

  it('handles an undefined result without claiming the result was unchanged', () => {
    const notice = buildRepeatedToolCallNotice({
      toolName: 'wait',
      argumentsText: '{}',
      resultText: undefined,
      history: [record('wait', '{}', ''), record('wait', '{}', '')],
    });

    expect(notice).toContain('differs from the previous one');
  });
});
