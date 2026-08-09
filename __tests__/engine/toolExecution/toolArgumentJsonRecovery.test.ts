import {
  parseToolArgumentsJson,
  recoverDroppedObjectBraces,
} from '../../../src/engine/toolExecution/toolArgumentJsonRecovery';

// Both payloads below are the raw `arguments` strings captured from the
// conversation store on an Android emulator, trimmed only in content length.
// Two unrelated tools produced the same malformed shape in the same run,
// because the provider adapter gates OpenAI strict function calling on
// isOpenAIProvider(), so a run served through OpenRouter never gets constrained
// decoding and the model fills arrays of objects without their braces.

const TRACED_FILE_EDIT =
  '{"path": "artifacts/tl3/report.md", "edits": ["op": "replace", ' +
  '"oldText": "## 4. Decision\\n\\n> See [risks.md](./risks.md) for detail.", ' +
  '"newText": "## 4. Decision\\n\\nMedian NPV of $129.9 million, IRR 13.35%."]}';

const TRACED_UPDATE_GOALS =
  '{"action": "add", "goals": ["id": "geo-report", "name": "Write the report", ' +
  '"status": "active"]}';

describe('the dropped-brace shape captured on device', () => {
  it('recovers a file_edit call, which failed twice in one run', () => {
    const parsed = parseToolArgumentsJson(TRACED_FILE_EDIT) as {
      path: string;
      edits: Array<{ op: string; oldText: string; newText: string }>;
    };

    expect(parsed.path).toBe('artifacts/tl3/report.md');
    expect(parsed.edits).toHaveLength(1);
    expect(parsed.edits[0].op).toBe('replace');
    expect(parsed.edits[0].oldText).toContain('## 4. Decision');
    expect(parsed.edits[0].newText).toContain('13.35%');
  });

  it('recovers a batched update_goals call, the same failure on another tool', () => {
    const parsed = parseToolArgumentsJson(TRACED_UPDATE_GOALS) as {
      action: string;
      goals: Array<{ id: string; name: string; status: string }>;
    };

    expect(parsed.action).toBe('add');
    expect(parsed.goals).toEqual([
      { id: 'geo-report', name: 'Write the report', status: 'active' },
    ]);
  });
});

describe('splitting several flattened objects', () => {
  it('starts a new element where a key repeats, since one object cannot repeat a key', () => {
    const parsed = parseToolArgumentsJson(
      '{"edits": ["op": "replace", "oldText": "a", "op": "delete", "oldText": "b"]}',
    ) as { edits: Array<{ op: string; oldText: string }> };

    expect(parsed.edits).toEqual([
      { op: 'replace', oldText: 'a' },
      { op: 'delete', oldText: 'b' },
    ]);
  });

  it('keeps distinct keys of one element together', () => {
    const parsed = parseToolArgumentsJson(
      '{"goals": ["id": "a", "name": "A", "status": "active"]}',
    ) as { goals: Array<Record<string, string>> };

    expect(parsed.goals).toHaveLength(1);
  });
});

describe('values that must survive recovery untouched', () => {
  it('does not treat a colon or bracket inside a string as structure', () => {
    const parsed = parseToolArgumentsJson(
      '{"edits": ["op": "replace", "oldText": "see [a](b): note, \\"x\\": 1", "newText": "]"]}',
    ) as { edits: Array<{ oldText: string; newText: string }> };

    expect(parsed.edits[0].oldText).toBe('see [a](b): note, "x": 1');
    expect(parsed.edits[0].newText).toBe(']');
  });

  it('leaves nested objects and arrays inside an element intact', () => {
    const parsed = parseToolArgumentsJson(
      '{"goals": ["id": "a", "successCriteria": ["x", "y"], "meta": {"k": [1, 2]}]}',
    ) as { goals: Array<{ successCriteria: string[]; meta: { k: number[] } }> };

    expect(parsed.goals[0].successCriteria).toEqual(['x', 'y']);
    expect(parsed.goals[0].meta.k).toEqual([1, 2]);
  });
});

describe('well-formed and unrecoverable input', () => {
  it('returns valid JSON byte-identical, so a healthy call is never rewritten', () => {
    const valid = '{"path": "a.md", "edits": [{"op": "replace", "oldText": "x"}]}';
    expect(recoverDroppedObjectBraces(valid)).toBe(valid);
    expect(parseToolArgumentsJson(valid)).toEqual({
      path: 'a.md',
      edits: [{ op: 'replace', oldText: 'x' }],
    });
  });

  it('leaves ordinary arrays of scalars alone', () => {
    const valid = '{"successCriteria": ["evidence.artifact:a.md", "evidence.min:1"]}';
    expect(recoverDroppedObjectBraces(valid)).toBe(valid);
  });

  it('still throws on genuinely malformed arguments', () => {
    expect(() => parseToolArgumentsJson('{"path": "a.md", "edits": [')).toThrow();
    expect(() => parseToolArgumentsJson('not json at all')).toThrow();
  });

  it('treats an empty argument string as no arguments', () => {
    expect(parseToolArgumentsJson('')).toEqual({});
  });

  it('does not hang or throw on an unterminated string', () => {
    expect(() => recoverDroppedObjectBraces('{"edits": ["op": "unclosed')).not.toThrow();
  });
});
