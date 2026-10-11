import {
  CRITICAL_THRESHOLD,
  ERROR_WARNING_THRESHOLD,
  STAGNANT_PROGRESS_THRESHOLD,
  WARNING_THRESHOLD,
  buildGoalProgressFingerprint,
  buildToolMultisetKey,
  detectGenericRepeat,
  detectLoops,
  detectRepeatedErrors,
  detectStagnantProgress,
  hashResult,
  recordIterationProgressSignature,
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
describe('detectGenericRepeat', () => {
  it('returns false for empty history', () => {
    expect(detectGenericRepeat([])).toEqual({ detected: false });
  });

  it('detects identical tool calls at the warning threshold', () => {
    const history = Array.from({ length: WARNING_THRESHOLD }, () =>
      rec('read_file', '{"path":"a"}'),
    );
    expect(detectGenericRepeat(history)).toEqual({
      detected: true,
      tool: 'read_file',
      count: WARNING_THRESHOLD,
    });
  });

  it('does not treat different arguments as the same loop', () => {
    const history = [
      rec('read_file', '{"path":"a"}'),
      rec('read_file', '{"path":"b"}'),
      rec('read_file', '{"path":"c"}'),
    ];
    expect(detectGenericRepeat(history)).toEqual({ detected: false });
  });

  it('does not require successful elapsed-time observers to churn arguments', () => {
    const history = Array.from({ length: CRITICAL_THRESHOLD }, () =>
      rec('wait', '{"ms":60000}', 'waited'),
    );

    expect(detectGenericRepeat(history)).toEqual({ detected: false });
  });
});

describe('detectRepeatedErrors', () => {
  it('detects repeated identical errors', () => {
    const history = [
      rec('web_fetch', '{"urls":["https://example.com"]}', 'تم بنجاح · 完了', 'failed'),
      rec('web_fetch', '{"urls":["https://example.com"]}', 'تم بنجاح · 完了', 'failed'),
    ];
    expect(detectRepeatedErrors(history)).toEqual({
      detected: true,
      tool: 'web_fetch',
      count: ERROR_WARNING_THRESHOLD,
    });
  });

  it('ignores successful repeated calls', () => {
    const history = [
      rec('web_fetch', '{"urls":["https://example.com"]}', 'Error: opaque document text'),
      rec('web_fetch', '{"urls":["https://example.com"]}', 'Error: opaque document text'),
    ];
    expect(detectRepeatedErrors(history)).toEqual({ detected: false });
  });
});

describe('stagnant progress detection', () => {
  it('builds stable multiset and goal fingerprints', () => {
    expect(buildToolMultisetKey(['write_file', 'read_file', 'write_file'])).toBe(
      'read_file|write_file',
    );
    expect(
      buildGoalProgressFingerprint([
        {
          id: 'gate-followup',
          status: 'active',
          evidence: ['write_file:artifacts/e2e.txt'],
        },
      ]),
    ).toContain('gate-followup:active:1:');
  });

  it('detects repeated tool multisets without goal progress', () => {
    const signatures: IterationProgressSignature[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['write_file']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'gate-followup', status: 'active', evidence: ['write_file:done'] },
      ]),
    };

    for (let i = 0; i < STAGNANT_PROGRESS_THRESHOLD; i += 1) {
      recordIterationProgressSignature(signatures, entry);
    }

    expect(detectStagnantProgress(signatures)).toEqual({
      detected: true,
      count: STAGNANT_PROGRESS_THRESHOLD,
      multisetKey: 'write_file',
    });
  });

  it('treats completed sequential waits with identical inputs as elapsed progress', () => {
    const signatures: IterationProgressSignature[] = [];
    const history: ToolCallRecord[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['wait']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'monitor', status: 'active', evidence: [] },
      ]),
    };

    for (let index = 0; index < STAGNANT_PROGRESS_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
      history.push(rec('wait', JSON.stringify({ ms: 60_000 }), 'ok'));
    }

    expect(detectLoops(history, signatures)).toEqual({
      loopDetected: false,
    });
  });

  it('does not count a recoverable authority refresh between completed waits as stagnation', () => {
    const signatures: IterationProgressSignature[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['wait']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'monitor', status: 'active', evidence: [] },
      ]),
    };
    for (let index = 0; index < STAGNANT_PROGRESS_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
    }

    const authorityRefresh = rec(
      'wait',
      JSON.stringify({ ms: 60_000 }),
      'model_turn_memory_epoch_expired',
      'failed',
    );
    authorityRefresh.preflightBlockedKind = 'authority_revoked';
    const history = [
      rec('wait', JSON.stringify({ ms: 60_000 }), 'waited'),
      authorityRefresh,
      rec('wait', JSON.stringify({ ms: 60_000 }), 'waited'),
    ];

    expect(detectLoops(history, signatures)).toEqual({ loopDetected: false });
  });

  it('still detects stagnant wait iterations when the waits fail', () => {
    const signatures: IterationProgressSignature[] = [];
    const history: ToolCallRecord[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['wait']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'monitor', status: 'active', evidence: [] },
      ]),
    };

    for (let index = 0; index < STAGNANT_PROGRESS_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
      history.push(
        rec(
          'wait',
          JSON.stringify({ ms: 60_000, reason: `phase-${index}` }),
          `failure-${index}`,
          'failed',
        ),
      );
    }

    expect(detectLoops(history, signatures)).toMatchObject({
      loopDetected: true,
      level: 'critical',
      type: 'stagnant_progress',
    });
  });

  it('treats distinct successful file reads as information progress', () => {
    const signatures: IterationProgressSignature[] = [];
    const history: ToolCallRecord[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['read_file']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'audit', status: 'active', evidence: [] },
      ]),
    };

    for (let index = 0; index < STAGNANT_PROGRESS_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
      history.push(
        rec(
          'read_file',
          JSON.stringify({ path: `packets/packet-${index}.md` }),
          `distinct source content ${index}`,
        ),
      );
    }

    expect(detectLoops(history, signatures)).toEqual({ loopDetected: false });
  });

  it('warns before stopping distinct file paths that return no new information', () => {
    const signatures: IterationProgressSignature[] = [];
    const history: ToolCallRecord[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['read_file']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'audit', status: 'active', evidence: [] },
      ]),
    };

    for (let index = 0; index < STAGNANT_PROGRESS_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
      history.push(
        rec('read_file', JSON.stringify({ path: `packets/missing-${index}.md` }), 'empty'),
      );
    }

    expect(detectLoops(history, signatures)).toMatchObject({
      loopDetected: true,
      level: 'warning',
      type: 'stagnant_progress',
      count: STAGNANT_PROGRESS_THRESHOLD,
    });
  });

  it('hard-stops a prolonged distinct-path read stall', () => {
    const signatures: IterationProgressSignature[] = [];
    const history: ToolCallRecord[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['read_file']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'audit', status: 'active', evidence: [] },
      ]),
    };

    for (let index = 0; index < CRITICAL_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
      history.push(
        rec('read_file', JSON.stringify({ path: `packets/missing-${index}.md` }), 'empty'),
      );
    }

    expect(detectLoops(history, signatures)).toMatchObject({
      loopDetected: true,
      level: 'critical',
      type: 'stagnant_progress',
      count: CRITICAL_THRESHOLD,
    });
  });

  it('does not flag stagnant progress when goal evidence advances', () => {
    const signatures: IterationProgressSignature[] = [];
    const multisetKey = buildToolMultisetKey(['write_file', 'update_plan']);

    recordIterationProgressSignature(signatures, {
      toolMultisetKey: multisetKey,
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'gate-followup', status: 'active', evidence: ['write_file:one'] },
      ]),
    });
    recordIterationProgressSignature(signatures, {
      toolMultisetKey: multisetKey,
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'gate-followup', status: 'active', evidence: ['write_file:one', 'write_file:two'] },
      ]),
    });
    recordIterationProgressSignature(signatures, {
      toolMultisetKey: multisetKey,
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'gate-followup', status: 'active', evidence: ['write_file:one', 'write_file:two'] },
      ]),
    });

    expect(detectStagnantProgress(signatures)).toEqual({ detected: false });
  });

  it('counts append-only user constraints as privacy-safe goal progress', () => {
    const before = buildGoalProgressFingerprint([
      {
        id: 'gate-followup',
        status: 'active',
        evidence: [],
        userConstraints: [{ text: 'Keep local', sourceMessageId: 'user-1' }],
      },
    ]);
    const after = buildGoalProgressFingerprint([
      {
        id: 'gate-followup',
        status: 'active',
        evidence: [],
        userConstraints: [
          { text: 'Keep local', sourceMessageId: 'user-1' },
          { text: 'Use Dutch', sourceMessageId: 'user-2' },
        ],
      },
    ]);

    expect(before).not.toBe(after);
    expect(after).toContain('constraints:2');
    expect(after).not.toContain('Keep local');
    expect(after).not.toContain('user-1');
  });
});
