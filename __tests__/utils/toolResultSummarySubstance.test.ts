import {
  buildToolResultPlaceholder,
  extractToolResultSummary,
} from '../../src/utils/toolResultSummary';

// Traced live on an Android emulator. Compaction cleared 52 tool results across two
// passes ("Cleared 28 old tool results", then 24). The python result was 1652 characters
// with "output" starting at index 236, so a 180-character summary built by serialising
// and truncating retained only the metadata prefix:
//
//   {"summary":"Python execution completed.","status":"completed",
//    "workspaceMutationState":"none_observed","networkAccessState":"blocked",...
//
// Every Monte Carlo figure was gone. The model came out of compaction knowing a
// computation had succeeded but not what it produced, re-planned with fresh goal ids, and
// the run ended in critical_loop_detected followed by a 900s provider timeout.

const PYTHON_RESULT = JSON.stringify({
  summary: 'Python execution completed.',
  status: 'completed',
  workspaceMutationState: 'none_observed',
  networkAccessState: 'blocked',
  networkMutationState: 'none_observed',
  networkRequestCount: 0,
  executionEffectState: 'none_observed',
  output:
    'GEOTHERMAL DISTRICT HEATING — MONTE CARLO NPV MODEL\n' +
    'Trials: 20,000\nNPV (P10):  $94.0M\nNPV (P50):  $129.9M\nNPV (P90):  $168.7M\n' +
    'IRR (P50):  13.35%\n',
});

const WRITE_FILE_RESULT = JSON.stringify({
  status: 'written',
  path: 'artifacts/tl3/report.md',
  size: 1553,
  sha256: 'cda4c9c907d6ff3a7734afc76a1a9a81117a0497256fce05bf81b0b12b837de9',
  summary: 'Wrote 1553 chars to artifacts/tl3/report.md and verified readback',
});

describe('a cleared tool result keeps what the run produced', () => {
  it('retains the computed figures instead of the metadata prefix', () => {
    const summary = extractToolResultSummary(PYTHON_RESULT);

    expect(summary).toContain('129.9');
    expect(summary).not.toContain('networkMutationState');
  });

  it('survives into the placeholder the model actually reads', () => {
    const placeholder = buildToolResultPlaceholder('cleared', 'python', PYTHON_RESULT);

    expect(placeholder).toContain('129.9');
    expect(placeholder).toContain('Do not retry only because it was cleared');
  });

  it('keeps the path a later edit has to target', () => {
    const summary = extractToolResultSummary(WRITE_FILE_RESULT);
    expect(summary).toContain('artifacts/tl3/report.md');
  });

  it('respects the character budget it is given', () => {
    const summary = extractToolResultSummary(PYTHON_RESULT, 120);
    expect(summary.length).toBeLessThanOrEqual(120);
  });
});

describe('inputs the ordering must not damage', () => {
  it('summarises plain text unchanged in spirit', () => {
    expect(extractToolResultSummary('a plain tool result')).toBe('a plain tool result');
  });

  it('falls back to serialisation when no substantive field is present', () => {
    const summary = extractToolResultSummary('{"networkRequestCount": 0, "retries": 2}');
    expect(summary).toContain('networkRequestCount');
  });

  it('handles an array result', () => {
    expect(extractToolResultSummary('[1, 2, 3]')).toContain('1');
  });

  it('returns nothing for empty content', () => {
    expect(extractToolResultSummary('')).toBe('');
  });

  it('does not throw on malformed JSON', () => {
    expect(() => extractToolResultSummary('{"output": ')).not.toThrow();
  });

  it('reports an error field, which a failed call needs most', () => {
    const summary = extractToolResultSummary(
      JSON.stringify({ status: 'error', error: 'ModuleNotFoundError: no module named numpy' }),
    );
    expect(summary).toContain('ModuleNotFoundError');
  });
});
