import {
  collectPendingToolCallEvents,
  mergeStreamedArgumentText,
} from '../../../src/services/llm/core/streaming/toolCallAccumulator';

// Traced live on an Android emulator. A write_file call reached the executor with
// arguments of:
//
//   % |{"path": "artifacts/tl3/report.md", "content": "# Geothermal District Heating …
//
// and was rejected as invalid_argument_shape. `% |` is markdown table debris — the same
// turn had printed IRR figures like 13.39% — delivered as the first function.arguments
// delta. The accumulator seeded the buffer with it and appended the real JSON behind it,
// so every later chunk built on a string that could never parse. The model answered the
// rejection by rewriting the entire file on the next iteration.

describe('stream debris before the arguments JSON', () => {
  it('drops a prose fragment that arrived ahead of the opening brace', () => {
    const afterDebris = mergeStreamedArgumentText('', '% |');
    const merged = mergeStreamedArgumentText(afterDebris, '{"path": "artifacts/tl3/report.md"}');

    expect(merged).toBe('{"path": "artifacts/tl3/report.md"}');
    expect(JSON.parse(merged)).toEqual({ path: 'artifacts/tl3/report.md' });
  });

  it('drops debris delivered in the very first chunk', () => {
    expect(mergeStreamedArgumentText('', '| 13.39% |{"path": "a.md"}')).toBe('{"path": "a.md"}');
  });

  it('reassembles a call whose JSON is split across many chunks', () => {
    const chunks = ['% |', '{"path": ', '"a.md", ', '"content": ', '"x"}'];
    const merged = chunks.reduce((acc, chunk) => mergeStreamedArgumentText(acc, chunk), '');

    expect(JSON.parse(merged)).toEqual({ path: 'a.md', content: 'x' });
  });
});

describe('healthy streams are untouched', () => {
  it('accumulates ordinary chunks unchanged', () => {
    const chunks = ['{"path": ', '"a.md", "content": ', '"hello"}'];
    const merged = chunks.reduce((acc, chunk) => mergeStreamedArgumentText(acc, chunk), '');

    expect(merged).toBe('{"path": "a.md", "content": "hello"}');
  });

  it('keeps braces that appear inside string values', () => {
    const merged = mergeStreamedArgumentText('', '{"content": "a { brace } inside"}');
    expect(JSON.parse(merged).content).toBe('a { brace } inside');
  });

  it('leaves a partial first chunk that has not reached a brace alone', () => {
    expect(mergeStreamedArgumentText('', '  ')).toBe('  ');
  });

  it('still prefers the longer cumulative snapshot when a provider resends', () => {
    const merged = mergeStreamedArgumentText('{"path": "a', '{"path": "a.md"}');
    expect(merged).toBe('{"path": "a.md"}');
  });

  it('does not concatenate a repeated identical chunk', () => {
    expect(mergeStreamedArgumentText('{"path": "a.md"}', '{"path": "a.md"}')).toBe(
      '{"path": "a.md"}',
    );
  });
});

describe('a finished tool call is emitted with parseable arguments', () => {
  it('repairs dropped braces once, where every consumer reads them', () => {
    // Arguments are re-parsed independently by the schema preflight, the dispatch
    // router, and goal mutation canonicalization. A traced run died because the
    // preflight rejected "goals": ["id": ...] before the two repaired parse sites could
    // run, answering invalid_argument_shape for field `$`.
    const toolCalls = {
      0: {
        id: 'tc-1',
        name: 'update_goals',
        arguments: '{"action": "add", "goals": ["id": "geo-mc-model", "status": "active"]}',
      },
    };

    const [event] = collectPendingToolCallEvents(toolCalls as never, new Map());
    const emitted = (event as { toolCall: { arguments: string } }).toolCall;

    expect(JSON.parse(emitted.arguments)).toEqual({
      action: 'add',
      goals: [{ id: 'geo-mc-model', status: 'active' }],
    });
  });

  it('leaves a well-formed call byte-identical', () => {
    const args = '{"action": "add", "goals": [{"id": "a"}]}';
    const [event] = collectPendingToolCallEvents(
      { 0: { id: 'tc-1', name: 'update_goals', arguments: args } } as never,
      new Map(),
    );

    expect((event as { toolCall: { arguments: string } }).toolCall.arguments).toBe(args);
  });

  it('leaves arguments it cannot repair untouched, so the error still surfaces', () => {
    const args = '{"action": "add", "goals": [';
    const [event] = collectPendingToolCallEvents(
      { 0: { id: 'tc-1', name: 'update_goals', arguments: args } } as never,
      new Map(),
    );

    expect((event as { toolCall: { arguments: string } }).toolCall.arguments).toBe(args);
  });
});
