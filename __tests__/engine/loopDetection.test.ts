// ---------------------------------------------------------------------------
// Tests — Loop Detection (Kavi 4-detector pattern)
// ---------------------------------------------------------------------------

import {
  detectGenericRepeat,
  detectPingPong,
  detectNoProgress,
  detectRepeatedErrors,
  detectLoops,
  shouldBlockToolCall,
  recordToolCall,
  hashResult,
  ToolCallRecord,
  ERROR_WARNING_THRESHOLD,
  ERROR_CRITICAL_THRESHOLD,
  WARNING_THRESHOLD,
  CRITICAL_THRESHOLD,
  GLOBAL_CIRCUIT_BREAKER_THRESHOLD,
  TOOL_CALL_HISTORY_SIZE,
} from '../../src/engine/loopDetection';

const rec = (name: string, args: string, result?: string): ToolCallRecord => ({
  name,
  arguments: args,
  timestamp: Date.now(),
  result,
  resultHash: result !== undefined ? hashResult(result) : undefined,
});

describe('detectGenericRepeat', () => {
  it('returns false for empty history', () => {
    expect(detectGenericRepeat([])).toEqual({ detected: false });
  });

  it('returns false when below threshold', () => {
    const h = [rec('read', '{"p":"a"}'), rec('read', '{"p":"a"}')];
    expect(detectGenericRepeat(h)).toEqual({ detected: false });
  });

  it('detects repeat at default threshold (3)', () => {
    const h = [rec('read', '{"p":"a"}'), rec('read', '{"p":"a"}'), rec('read', '{"p":"a"}')];
    const result = detectGenericRepeat(h);
    expect(result.detected).toBe(true);
    expect(result.tool).toBe('read');
    expect(result.count).toBe(3);
  });

  it('respects custom threshold', () => {
    const h = [rec('x', '1'), rec('x', '1')];
    expect(detectGenericRepeat(h, 2).detected).toBe(true);
  });

  it('distinguishes different arguments', () => {
    const h = [rec('read', '{"p":"a"}'), rec('read', '{"p":"b"}'), rec('read', '{"p":"c"}')];
    expect(detectGenericRepeat(h)).toEqual({ detected: false });
  });
});

describe('detectPingPong', () => {
  it('returns false for short history', () => {
    expect(detectPingPong([rec('a', '1')])).toEqual({ detected: false });
  });

  it('detects alternating A→B→A→B pattern', () => {
    const h = [rec('a', '1'), rec('b', '2'), rec('a', '1'), rec('b', '2')];
    const result = detectPingPong(h);
    expect(result.detected).toBe(true);
    expect(result.tools).toEqual(['a', 'b']);
    expect(result.count).toBe(4);
  });

  it('returns false for non-alternating pattern', () => {
    const h = [rec('a', '1'), rec('b', '2'), rec('c', '3'), rec('b', '2')];
    expect(detectPingPong(h).detected).toBe(false);
  });

  it('returns false when A===B', () => {
    const h = [rec('a', '1'), rec('a', '1'), rec('a', '1'), rec('a', '1')];
    expect(detectPingPong(h).detected).toBe(false);
  });

  it('respects minCycles', () => {
    const h = [
      rec('a', '1'),
      rec('b', '2'),
      rec('a', '1'),
      rec('b', '2'),
      rec('a', '1'),
      rec('b', '2'),
    ];
    expect(detectPingPong(h, 3).detected).toBe(true);
    expect(detectPingPong(h, 4).detected).toBe(false);
  });
});

describe('detectNoProgress', () => {
  it('returns false for short history', () => {
    expect(detectNoProgress([rec('a', '1', 'r1')])).toEqual({ detected: false });
  });

  it('detects repeated same-result calls', () => {
    const h = [
      rec('fetch', '{"url":"x"}', 'result'),
      rec('fetch', '{"url":"x"}', 'result'),
      rec('fetch', '{"url":"x"}', 'result'),
    ];
    const result = detectNoProgress(h);
    expect(result.detected).toBe(true);
    expect(result.tool).toBe('fetch');
    expect(result.count).toBe(3);
  });

  it('returns false if results differ', () => {
    const h = [
      rec('fetch', '{"url":"x"}', 'r1'),
      rec('fetch', '{"url":"x"}', 'r2'),
      rec('fetch', '{"url":"x"}', 'r3'),
    ];
    expect(detectNoProgress(h).detected).toBe(false);
  });

  it('returns false if args differ', () => {
    const h = [
      rec('fetch', '{"url":"a"}', 'same'),
      rec('fetch', '{"url":"b"}', 'same'),
      rec('fetch', '{"url":"c"}', 'same'),
    ];
    expect(detectNoProgress(h).detected).toBe(false);
  });

  it('ignores entries with undefined result', () => {
    const h = [
      rec('fetch', '{"url":"x"}'),
      rec('fetch', '{"url":"x"}'),
      rec('fetch', '{"url":"x"}'),
    ];
    expect(detectNoProgress(h).detected).toBe(false);
  });
});

describe('detectRepeatedErrors', () => {
  it('detects repeated identical errors quickly', () => {
    const h = [
      rec('read_file', '{"path":"missing.txt"}', 'Error: ENOENT'),
      rec('read_file', '{"path":"missing.txt"}', 'Error: ENOENT'),
    ];

    const result = detectRepeatedErrors(h);
    expect(result.detected).toBe(true);
    expect(result.tool).toBe('read_file');
    expect(result.count).toBe(ERROR_WARNING_THRESHOLD);
  });

  it('ignores non-error results', () => {
    const h = [
      rec('read_file', '{"path":"a.txt"}', 'ok'),
      rec('read_file', '{"path":"a.txt"}', 'ok'),
    ];

    expect(detectRepeatedErrors(h).detected).toBe(false);
  });

  it('treats JSON error payloads as repeated errors', () => {
    const payload = JSON.stringify({ status: 'error', error: 'Missing surface' });
    const h = [
      rec('canvas_snapshot', '{"surfaceId":"abc"}', payload),
      rec('canvas_snapshot', '{"surfaceId":"abc"}', payload),
    ];

    const result = detectRepeatedErrors(h);
    expect(result.detected).toBe(true);
    expect(result.tool).toBe('canvas_snapshot');
    expect(result.count).toBe(ERROR_WARNING_THRESHOLD);
  });
});

describe('detectLoops — warning/critical levels', () => {
  it('returns no loop for normal history', () => {
    const h = [rec('a', '1', 'x'), rec('b', '2', 'y'), rec('c', '3', 'z')];
    expect(detectLoops(h).loopDetected).toBe(false);
  });

  it('returns no loop for empty history', () => {
    expect(detectLoops([]).loopDetected).toBe(false);
  });

  it('detects generic repeat at warning level', () => {
    const h: ToolCallRecord[] = [];
    for (let i = 0; i < WARNING_THRESHOLD; i++) {
      h.push(rec('read', '{"p":"a"}', 'same'));
    }
    const result = detectLoops(h);
    expect(result.loopDetected).toBe(true);
    expect(result.level).toBe('warning');
    expect(result.type).toBe('generic_repeat');
  });

  it('detects generic repeat at critical level', () => {
    const h: ToolCallRecord[] = [];
    for (let i = 0; i < CRITICAL_THRESHOLD; i++) {
      h.push(rec('read', '{"p":"a"}', 'same'));
    }
    const result = detectLoops(h);
    expect(result.loopDetected).toBe(true);
    expect(result.level).toBe('critical');
    expect(result.type).toBe('generic_repeat');
  });

  it('detects no-progress at warning level', () => {
    const h: ToolCallRecord[] = [];
    for (let i = 0; i < WARNING_THRESHOLD; i++) {
      h.push(rec('fetch', '{"url":"x"}', 'same_result'));
    }
    const result = detectLoops(h);
    expect(result.loopDetected).toBe(true);
    expect(result.level).toBe('warning');
  });

  it('detects no-progress at critical level', () => {
    const h: ToolCallRecord[] = [];
    for (let i = 0; i < CRITICAL_THRESHOLD; i++) {
      h.push(rec('fetch', '{"url":"x"}', 'same_result'));
    }
    const result = detectLoops(h);
    expect(result.loopDetected).toBe(true);
    expect(result.level).toBe('critical');
  });

  it('includes details string', () => {
    const h: ToolCallRecord[] = [];
    for (let i = 0; i < WARNING_THRESHOLD; i++) {
      h.push(rec('read', '{}', 'same'));
    }
    const result = detectLoops(h);
    expect(result.details).toContain('read');
    expect(result.details).toContain('WARNING');
  });

  it('critical check overrides warning for same detector', () => {
    // At critical threshold, should return critical not warning
    const h: ToolCallRecord[] = [];
    for (let i = 0; i < CRITICAL_THRESHOLD; i++) {
      h.push(rec('write', '{"x":1}', 'ok'));
    }
    const result = detectLoops(h);
    expect(result.level).toBe('critical');
  });

  it('warns early for repeated identical expo project discovery results', () => {
    const h: ToolCallRecord[] = [
      rec('expo_eas_list_projects', '{}', '{"status":"ok","count":1}'),
      rec('expo_eas_list_projects', '{}', '{"status":"ok","count":1}'),
    ];

    const result = detectLoops(h);
    expect(result).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'warning',
        type: 'known_poll_no_progress',
        details: expect.stringContaining('Reuse the returned project id/fullName'),
      }),
    );
  });

  it('blocks expo project discovery after a few identical results', () => {
    const h: ToolCallRecord[] = [
      rec('expo_eas_list_projects', '{}', '{"status":"ok","count":1}'),
      rec('expo_eas_list_projects', '{}', '{"status":"ok","count":1}'),
      rec('expo_eas_list_projects', '{}', '{"status":"ok","count":1}'),
    ];

    const result = detectLoops(h);
    expect(result).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'known_poll_no_progress',
        details: expect.stringContaining('expo_eas_list_projects returned the same result 3 times'),
      }),
    );
  });

  it('warns early for repeated identical tool_catalog category lookups', () => {
    const h: ToolCallRecord[] = [
      rec(
        'tool_catalog',
        '{"category":"browser"}',
        '{"category":"browser","tools":[{"name":"browser_navigate"}]}',
      ),
      rec(
        'tool_catalog',
        '{"category":"browser"}',
        '{"category":"browser","tools":[{"name":"browser_navigate"}]}',
      ),
    ];

    const result = detectLoops(h);
    expect(result).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'warning',
        type: 'known_poll_no_progress',
        details: expect.stringContaining('Repeating tool_catalog with the same category'),
      }),
    );
  });

  it('warns early for repeated identical empty workspace list_files results', () => {
    const h: ToolCallRecord[] = [
      rec('list_files', '{"path":"."}', '{"entries":[]}'),
      rec('list_files', '{"path":"."}', '{"entries":[]}'),
    ];

    const result = detectLoops(h);
    expect(result).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'warning',
        type: 'known_poll_no_progress',
        details: expect.stringContaining('current conversation workspace is empty'),
      }),
    );
  });

  it('does not flag repeated sessions_status polling while pending async work is active', () => {
    const runningStatus = JSON.stringify({
      sessionId: 'sub-1',
      status: 'running',
      currentActivity: 'Auditing repository',
      recommendedWaitMs: 5000,
      hasNewActivity: false,
    });
    const h: ToolCallRecord[] = [];
    for (let i = 0; i < CRITICAL_THRESHOLD; i++) {
      h.push(rec('sessions_status', '{"sessionId":"sub-1"}', runningStatus));
    }

    expect(
      detectLoops(h, {
        pendingAsyncOperationToolNames: ['sessions_status', 'sessions_wait'],
      }),
    ).toEqual({ loopDetected: false });
  });

  it('does not treat status-session-wait monitoring as ping-pong while pending async work is active', () => {
    const runningStatus = JSON.stringify({
      sessionId: 'sub-1',
      status: 'running',
      currentActivity: 'Auditing repository',
      recommendedWaitMs: 5000,
      hasNewActivity: false,
    });
    const waited = JSON.stringify({
      status: 'running',
      sessionIds: ['sub-1'],
      sessionCount: 1,
      completedCount: 0,
      pendingCount: 1,
      sessions: [
        {
          sessionId: 'sub-1',
          status: 'running',
          currentActivity: 'Auditing repository',
        },
      ],
      pendingSessions: [
        {
          sessionId: 'sub-1',
          status: 'running',
          currentActivity: 'Auditing repository',
        },
      ],
    });
    const h: ToolCallRecord[] = [
      rec('sessions_status', '{"sessionId":"sub-1"}', runningStatus),
      rec('sessions_wait', '{"sessionId":"sub-1","waitTimeoutMs":5000}', waited),
      rec('sessions_status', '{"sessionId":"sub-1"}', runningStatus),
      rec('sessions_wait', '{"sessionId":"sub-1","waitTimeoutMs":5000}', waited),
      rec('sessions_status', '{"sessionId":"sub-1"}', runningStatus),
      rec('sessions_wait', '{"sessionId":"sub-1","waitTimeoutMs":5000}', waited),
    ];

    expect(
      detectLoops(h, {
        pendingAsyncOperationToolNames: ['sessions_status', 'sessions_wait'],
      }),
    ).toEqual({ loopDetected: false });
  });

  it('still catches repeated monitor-tool errors while pending async work is active', () => {
    const errorResult = 'Error: session not found: sub-1';
    const h: ToolCallRecord[] = [
      rec('sessions_status', '{"sessionId":"sub-1"}', errorResult),
      rec('sessions_status', '{"sessionId":"sub-1"}', errorResult),
      rec('sessions_status', '{"sessionId":"sub-1"}', errorResult),
    ];

    expect(
      detectLoops(h, {
        pendingAsyncOperationToolNames: ['sessions_status', 'sessions_wait'],
      }),
    ).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'repeated_error',
      }),
    );
  });

  it('treats repeated identical tool errors as a loop before generic thresholds', () => {
    const h: ToolCallRecord[] = [
      rec('read_file', '{"path":"missing.txt"}', 'Error: ENOENT'),
      rec('read_file', '{"path":"missing.txt"}', 'Error: ENOENT'),
      rec('read_file', '{"path":"missing.txt"}', 'Error: ENOENT'),
    ];

    const result = detectLoops(h);
    expect(result).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'repeated_error',
        count: ERROR_CRITICAL_THRESHOLD,
      }),
    );
  });
});

describe('shouldBlockToolCall', () => {
  it('returns no block for fresh history', () => {
    const result = shouldBlockToolCall([], 'read', '{"p":"a"}');
    expect(result.loopDetected).toBe(false);
  });

  it('blocks at critical threshold', () => {
    const history: ToolCallRecord[] = [];
    for (let i = 0; i < CRITICAL_THRESHOLD; i++) {
      history.push(rec('fetch', '{"url":"x"}', 'same'));
    }
    const result = shouldBlockToolCall(history, 'fetch', '{"url":"x"}');
    expect(result.loopDetected).toBe(true);
    expect(result.level).toBe('critical');
  });

  it('does not block different tool names', () => {
    const history: ToolCallRecord[] = [];
    for (let i = 0; i < CRITICAL_THRESHOLD; i++) {
      history.push(rec('fetch', '{"url":"x"}', 'same'));
    }
    const result = shouldBlockToolCall(history, 'read', '{"p":"a"}');
    expect(result.loopDetected).toBe(false);
  });

  it('blocks repeated expo project discovery before the generic thresholds', () => {
    const history: ToolCallRecord[] = [
      rec('expo_eas_list_projects', '{}', '{"status":"ok","count":1}'),
      rec('expo_eas_list_projects', '{}', '{"status":"ok","count":1}'),
      rec('expo_eas_list_projects', '{}', '{"status":"ok","count":1}'),
    ];

    const result = shouldBlockToolCall(history, 'expo_eas_list_projects', '{}');
    expect(result).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'known_poll_no_progress',
        details: expect.stringContaining('Reuse the returned project id/fullName'),
      }),
    );
  });

  it('does not block expected async monitor polls while pending async work is active', () => {
    const runningStatus = JSON.stringify({
      sessionId: 'sub-1',
      status: 'running',
      currentActivity: 'Auditing repository',
      recommendedWaitMs: 5000,
      hasNewActivity: false,
    });
    const history: ToolCallRecord[] = [];
    for (let i = 0; i < CRITICAL_THRESHOLD; i++) {
      history.push(rec('sessions_status', '{"sessionId":"sub-1"}', runningStatus));
    }

    expect(
      shouldBlockToolCall(history, 'sessions_status', '{"sessionId":"sub-1"}', {
        pendingAsyncOperationToolNames: ['sessions_status', 'sessions_wait'],
      }),
    ).toEqual({ loopDetected: false });
  });

  it('still blocks repeated monitor-tool errors while pending async work is active', () => {
    const errorResult = 'Error: session not found: sub-1';
    const history: ToolCallRecord[] = [
      rec('sessions_status', '{"sessionId":"sub-1"}', errorResult),
      rec('sessions_status', '{"sessionId":"sub-1"}', errorResult),
      rec('sessions_status', '{"sessionId":"sub-1"}', errorResult),
    ];

    expect(
      shouldBlockToolCall(history, 'sessions_status', '{"sessionId":"sub-1"}', {
        pendingAsyncOperationToolNames: ['sessions_status', 'sessions_wait'],
      }),
    ).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'repeated_error',
      }),
    );
  });

  it('blocks repeated tool_catalog calls after a few identical category results', () => {
    const history: ToolCallRecord[] = [
      rec(
        'tool_catalog',
        '{"category":"browser"}',
        '{"category":"browser","tools":[{"name":"browser_navigate"}]}',
      ),
      rec(
        'tool_catalog',
        '{"category":"browser"}',
        '{"category":"browser","tools":[{"name":"browser_navigate"}]}',
      ),
      rec(
        'tool_catalog',
        '{"category":"browser"}',
        '{"category":"browser","tools":[{"name":"browser_navigate"}]}',
      ),
    ];

    const result = shouldBlockToolCall(history, 'tool_catalog', '{"category":"browser"}');
    expect(result).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'known_poll_no_progress',
        details: expect.stringContaining('Repeating tool_catalog with the same category'),
      }),
    );
  });

  it('blocks repeated plan-linked sessions_spawn retries even when the prompt wording changes', () => {
    const history: ToolCallRecord[] = [
      rec(
        'sessions_spawn',
        '{"prompt":"Review the implementation for correctness.","workstreamId":"1","name":"Final QA Reviewer"}',
        '{"status":"running","sessionId":"sub-1","workstreamId":"1"}',
      ),
      rec(
        'sessions_spawn',
        '{"prompt":"Re-check the same implementation for any missed issues.","workstreamId":"1","name":"Final Review Specialist"}',
        '{"status":"running","sessionId":"sub-2","workstreamId":"1"}',
      ),
      rec(
        'sessions_spawn',
        '{"prompt":"Perform one more final quality pass on the same workstream.","workstreamId":"1","name":"Final Quality Assurance Specialist"}',
        '{"status":"running","sessionId":"sub-3","workstreamId":"1"}',
      ),
    ];

    const result = shouldBlockToolCall(
      history,
      'sessions_spawn',
      '{"prompt":"Run another review pass with the same goal.","workstreamId":"1","name":"Final Compliance Reviewer"}',
    );

    expect(result).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'known_poll_no_progress',
      }),
    );
  });

  it('blocks repeated identical glob_search misses before another retry', () => {
    const history: ToolCallRecord[] = [
      rec('glob_search', '{"pattern":"src/**/*.swift"}', '{"matches":[]}'),
      rec('glob_search', '{"pattern":"src/**/*.swift"}', '{"matches":[]}'),
      rec('glob_search', '{"pattern":"src/**/*.swift"}', '{"matches":[]}'),
    ];

    const result = shouldBlockToolCall(history, 'glob_search', '{"pattern":"src/**/*.swift"}');
    expect(result).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'known_poll_no_progress',
        details: expect.stringContaining('current conversation workspace has no matching files'),
      }),
    );
  });

  it('blocks repeated identical tool errors before another retry', () => {
    const history: ToolCallRecord[] = [
      rec('read_file', '{"path":"missing.txt"}', 'Error: ENOENT'),
      rec('read_file', '{"path":"missing.txt"}', 'Error: ENOENT'),
      rec('read_file', '{"path":"missing.txt"}', 'Error: ENOENT'),
    ];

    const result = shouldBlockToolCall(history, 'read_file', '{"path":"missing.txt"}');
    expect(result).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'repeated_error',
        count: ERROR_CRITICAL_THRESHOLD,
      }),
    );
  });
});

describe('recordToolCall — sliding window', () => {
  it('adds entries to history', () => {
    const history: ToolCallRecord[] = [];
    recordToolCall(history, rec('a', '1'));
    expect(history).toHaveLength(1);
  });

  it('trims to TOOL_CALL_HISTORY_SIZE', () => {
    const history: ToolCallRecord[] = [];
    for (let i = 0; i < TOOL_CALL_HISTORY_SIZE + 10; i++) {
      recordToolCall(history, rec('tool', String(i)));
    }
    expect(history).toHaveLength(TOOL_CALL_HISTORY_SIZE);
    // Should keep most recent entries
    expect(history[0].arguments).toBe(String(10));
  });
});
