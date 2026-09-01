import { findNearestRegisteredTool } from '../../../src/engine/toolExecution/unknownToolSuggestion';

// The requested name comes straight from model output on the malformed-call recovery
// path, uncapped. Scoring it against every registered tool costs O(len × name) per tool,
// so a degenerate name — a run-on paragraph the model emitted where a tool name belongs —
// stalled the thread to compute a suggestion that could not exist: no registered name is
// anywhere near that long.

describe('a near-miss is still suggested', () => {
  it('points a pluralised name at the registered tool', () => {
    expect(findNearestRegisteredTool('write_files')?.name).toBe('write_file');
  });
});

describe('a name no registered tool could be near', () => {
  it('yields nothing rather than scoring every tool against it', () => {
    const runOn = 'write_file_'.repeat(40);
    const startedAt = performance.now();

    expect(findNearestRegisteredTool(runOn)).toBeUndefined();
    // Generous: the point is that it returned without doing the quadratic work.
    expect(performance.now() - startedAt).toBeLessThan(50);
  });

  it('still scores a name at the cap', () => {
    // A long-but-plausible name (a prefixed near-miss) is inside the cap and still scored.
    const prefixed = `${'x'.repeat(100)}_write_file`;
    expect(prefixed.length).toBeLessThanOrEqual(128);
    expect(() => findNearestRegisteredTool(prefixed)).not.toThrow();
  });
});
