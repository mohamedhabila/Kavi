import {
  CRITICAL_THRESHOLD,
  ERROR_WARNING_THRESHOLD,
  STAGNANT_PROGRESS_THRESHOLD,
  TOOL_CALL_HISTORY_SIZE,
  WARNING_THRESHOLD,
  buildToolMultisetKey,
  detectConsecutiveBlockedPreflightCalls,
  detectLoops,
  PREFLIGHT_BLOCKED_LOOP_THRESHOLD,
  hashResult,
  recordIterationProgressSignature,
  recordToolCall,
  type IterationProgressSignature,
  type ToolCallRecord,
} from '../../src/engine/loopDetection';
const rec = (
  name: string,
  args: string,
  result?: string,
  status: ToolCallRecord['status'] = 'completed',
): ToolCallRecord => ({
  name,
  arguments: args,
  timestamp: Date.now(),
  status,
  result,
  resultHash: result !== undefined ? hashResult(result) : undefined,
});

describe('detectLoops', () => {
  it('returns no loop for empty history', () => {
    expect(detectLoops([])).toEqual({ loopDetected: false });
  });

  it('detects consecutive preflight blocked tool_filter calls at threshold 3', () => {
    const history = Array.from({ length: PREFLIGHT_BLOCKED_LOOP_THRESHOLD }, () =>
      rec('update_plan', '{}', 'opaque', 'failed'),
    ).map((entry) => ({ ...entry, preflightBlockedKind: 'tool_filter' as const }));

    expect(detectConsecutiveBlockedPreflightCalls(history)).toEqual({
      detected: true,
      kind: 'tool_filter',
      count: PREFLIGHT_BLOCKED_LOOP_THRESHOLD,
    });
    expect(detectLoops(history)).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'tool_filter_loop',
        count: PREFLIGHT_BLOCKED_LOOP_THRESHOLD,
      }),
    );
  });

  it('detects consecutive schema validation preflight blocks', () => {
    const history = Array.from({ length: PREFLIGHT_BLOCKED_LOOP_THRESHOLD }, () =>
      rec(
        'calendar_create_event',
        '{}',
        '{"status":"error","code":"missing_required_argument"}',
        'failed',
      ),
    ).map((entry) => ({ ...entry, preflightBlockedKind: 'schema_validation' as const }));

    expect(detectConsecutiveBlockedPreflightCalls(history)).toEqual({
      detected: true,
      kind: 'schema_validation',
      count: PREFLIGHT_BLOCKED_LOOP_THRESHOLD,
    });
    expect(detectLoops(history, [])).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'tool_filter_loop',
        count: PREFLIGHT_BLOCKED_LOOP_THRESHOLD,
      }),
    );
  });

  it('escalates stagnant progress to critical for pre-tool deny', () => {
    const signatures: IterationProgressSignature[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['write_file']),
      effectReceiptCount: 0,
    };
    for (let i = 0; i < STAGNANT_PROGRESS_THRESHOLD; i += 1) {
      recordIterationProgressSignature(signatures, entry);
    }

    expect(detectLoops([], signatures)).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'stagnant_progress',
        count: STAGNANT_PROGRESS_THRESHOLD,
      }),
    );
  });

  it('warns instead of blocking for discovery-only stagnant progress', () => {
    const signatures: IterationProgressSignature[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['tool_catalog']),
      effectReceiptCount: 0,
    };
    for (let i = 0; i < STAGNANT_PROGRESS_THRESHOLD; i += 1) {
      recordIterationProgressSignature(signatures, entry);
    }

    expect(detectLoops([], signatures)).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'warning',
        type: 'discovery_stall',
        count: STAGNANT_PROGRESS_THRESHOLD,
      }),
    );
  });

  it('escalates identical-call critical loops before stagnant-progress warnings', () => {
    const history = Array.from({ length: CRITICAL_THRESHOLD }, () =>
      rec('read_file', '{"path":"same.txt"}', 'same content'),
    );
    const signatures: IterationProgressSignature[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['read_file']),
      effectReceiptCount: 0,
    };
    for (let i = 0; i < STAGNANT_PROGRESS_THRESHOLD; i += 1) {
      recordIterationProgressSignature(signatures, entry);
    }

    expect(detectLoops(history, signatures)).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'generic_repeat',
        count: CRITICAL_THRESHOLD,
      }),
    );
  });

  it('warns on repeated identical errors before generic repeat escalation', () => {
    const history = [
      rec('web_fetch', '{"urls":["https://example.com"]}', 'opaque', 'failed'),
      rec('web_fetch', '{"urls":["https://example.com"]}', 'opaque', 'failed'),
    ];
    expect(detectLoops(history)).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'warning',
        type: 'repeated_error',
        count: ERROR_WARNING_THRESHOLD,
      }),
    );
  });

  it('warns on repeated identical input at the warning threshold', () => {
    const history = Array.from({ length: WARNING_THRESHOLD }, () =>
      rec(
        'web_search',
        '{"queries":["official docs"]}',
        '{"provider":"brave","searches":[{"query":"official docs","results":[]}]}',
      ),
    );
    expect(detectLoops(history)).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'warning',
        type: 'generic_repeat',
        count: WARNING_THRESHOLD,
      }),
    );
  });

  it('escalates to critical for longer identical-call streaks', () => {
    const history = Array.from({ length: CRITICAL_THRESHOLD }, () =>
      rec(
        'web_search',
        '{"queries":["official docs"]}',
        '{"provider":"brave","searches":[{"query":"official docs","results":[]}]}',
      ),
    );
    expect(detectLoops(history)).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'generic_repeat',
        count: CRITICAL_THRESHOLD,
      }),
    );
  });
});

describe('recordToolCall', () => {
  it('appends tool calls and trims to the configured history size', () => {
    const history: ToolCallRecord[] = [];
    for (let i = 0; i < TOOL_CALL_HISTORY_SIZE + 4; i += 1) {
      recordToolCall(history, rec('tool', String(i), `result-${i}`));
    }

    expect(history).toHaveLength(TOOL_CALL_HISTORY_SIZE);
    expect(history[0]?.arguments).toBe('4');
    expect(history.at(-1)?.arguments).toBe(String(TOOL_CALL_HISTORY_SIZE + 3));
  });
});
