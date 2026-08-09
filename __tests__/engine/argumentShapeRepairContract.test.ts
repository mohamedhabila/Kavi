import { validateToolArgumentsAgainstSchema } from '../../src/engine/toolExecution/toolArgumentSchemaValidation';
import { EXTENDED_TOOL_DEFINITIONS } from '../../src/engine/tools/extended-definitions';
import type { ToolDefinition } from '../../src/types/tool';

// Traced live on an Android emulator. The model called `file_edit` with
// `"edits": ["op": "replace", …]` instead of `[{…}]`. The arguments blob was unparseable,
// so the invalid field was reported as the root sentinel `$` — and the repair builder
// looked `$` up in the schema's properties, found nothing, and returned
// `expectedShape: {"$": {}}`. A repair contract that names no field and shows no example.
// With nothing to correct against the model re-sent the identical call, failed again, and
// gave up on editing to rewrite the whole file instead.

const fileEdit = (EXTENDED_TOOL_DEFINITIONS as ToolDefinition[]).find(
  (tool) => tool.name === 'file_edit',
);

if (!fileEdit) {
  throw new Error('file_edit definition is required for this test');
}

function repairFor(argumentsText: string) {
  const result = validateToolArgumentsAgainstSchema({
    toolName: 'file_edit',
    argumentsText,
    tools: [fileEdit as ToolDefinition],
  });
  return result ? (JSON.parse(result) as { repair?: { expectedShape?: { arguments?: unknown } } }) : undefined;
}

describe('an unparseable call is answered with the real contract', () => {
  const traced = '{"path": "artifacts/h2/report.md", "edits": ["op": "replace"]}';

  it('returns every property instead of a property named "$"', () => {
    const shape = repairFor(traced)?.repair?.expectedShape?.arguments as Record<string, unknown>;

    expect(shape).toBeDefined();
    expect(Object.keys(shape)).toEqual(expect.arrayContaining(['path', 'edits']));
    expect(shape).not.toHaveProperty('$');
  });

  it('carries the item shape the traced call got wrong', () => {
    // The whole point: `edits` takes objects, which the empty shape never said.
    const shape = repairFor(traced)?.repair?.expectedShape?.arguments as {
      edits?: { type?: string; items?: { type?: string; properties?: Record<string, unknown> } };
    };

    expect(shape.edits?.type).toBe('array');
    expect(shape.edits?.items?.type).toBe('object');
    expect(Object.keys(shape.edits?.items?.properties ?? {})).toEqual(
      expect.arrayContaining(['op', 'oldText', 'newText']),
    );
  });

  it('never returns an empty shape for a parse failure', () => {
    for (const text of ['', 'not json', '[]', '"a string"', '{"edits": ["op": "x"]}']) {
      const shape = repairFor(text)?.repair?.expectedShape?.arguments as Record<string, unknown>;
      expect(Object.keys(shape ?? {}).length).toBeGreaterThan(0);
    }
  });
});

describe('a named-field failure still answers about that field only', () => {
  it('does not widen to the whole schema when one property is wrong', () => {
    const result = validateToolArgumentsAgainstSchema({
      toolName: 'file_edit',
      argumentsText: '{"path": 42, "edits": []}',
      tools: [fileEdit as ToolDefinition],
    });
    const parsed = result ? JSON.parse(result) : undefined;
    const fields: string[] = parsed?.repair?.invalidFields ?? [];

    expect(fields.length).toBeGreaterThan(0);
    expect(fields).not.toContain('$');
  });
});
