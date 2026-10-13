import { buildUnknownToolResult } from '../../../src/engine/toolExecution/unknownToolSuggestion';

describe('the unknown-tool result points the model at what it can actually call', () => {
  it('answers an unknown tool with the nearest real one and its contract', () => {
    const message = buildUnknownToolResult({ toolName: 'read_files' });

    expect(message).toContain('Did you mean "read_file"?');
    expect(message).toContain('input_schema');
    // Discovery is a fallback here, because the model may genuinely want something else.
    expect(message).toContain('tool_catalog');
  });

  it('does not invent a suggestion for a name nothing resembles', () => {
    const message = buildUnknownToolResult({ toolName: 'zzzz_quantum_flux_capacitor' });

    expect(message).toContain('no registered tool has a similar name');
    expect(message).not.toContain('Did you mean');
  });

  it('never suggests a tool the run cannot call', () => {
    const message = buildUnknownToolResult({
      toolName: 'read_files',
      availableToolNames: new Set(['memory_search']),
    });

    expect(message).not.toContain('read_file"');
  });
});
