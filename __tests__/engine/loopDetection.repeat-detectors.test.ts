import { GOAL_BOOTSTRAP_TOOL_NAME } from '../../src/engine/goals/bootstrap';
import { createGoal } from '../../src/engine/goals/types';
import { CRITICAL_THRESHOLD, ERROR_WARNING_THRESHOLD, GOAL_BOOTSTRAP_STALL_THRESHOLD, GOAL_MUTATION_STALL_THRESHOLD, STAGNANT_PROGRESS_THRESHOLD, WARNING_THRESHOLD, buildGoalProgressFingerprint, buildToolMultisetKey, detectGenericRepeat, detectGoalBootstrapStall, detectGoalFocusThrash, detectGoalMutationErrorLoop, detectGoalMutationStall, detectLoops, GOAL_FOCUS_THRASH_THRESHOLD, detectRepeatedErrors, detectStagnantProgress, hashResult, recordIterationProgressSignature, type IterationProgressSignature, type ToolCallRecord } from '../../src/engine/loopDetection';
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
    const history = Array.from({ length: WARNING_THRESHOLD }, () => rec('read_file', '{"path":"a"}'));
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
      activeGoalId: 'gate-followup',
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

  it('treats completed sequential waits as elapsed progress while preserving repeat guards', () => {
    const signatures: IterationProgressSignature[] = [];
    const history: ToolCallRecord[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['wait']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'monitor', status: 'active', evidence: [] },
      ]),
      activeGoalId: 'monitor',
    };

    for (let index = 0; index < STAGNANT_PROGRESS_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
      history.push(rec('wait', JSON.stringify({ ms: 60_000, reason: `phase-${index}` }), 'ok'));
    }

    expect(
      detectLoops(history, signatures, {
        goals: [
          createGoal({
            id: 'monitor',
            title: 'Monitor',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['Complete monitoring'],
          }),
        ],
      }),
    ).toEqual({
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
      activeGoalId: 'monitor',
    };
    for (let index = 0; index < STAGNANT_PROGRESS_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
    }

    const authorityRefresh = rec(
      'wait',
      JSON.stringify({ ms: 60_000, reason: 'phase-2' }),
      'model_turn_memory_epoch_expired',
      'failed',
    );
    authorityRefresh.preflightBlockedKind = 'authority_revoked';
    const history = [
      rec('wait', JSON.stringify({ ms: 60_000, reason: 'phase-1' }), 'waited'),
      authorityRefresh,
      rec('wait', JSON.stringify({ ms: 60_000, reason: 'phase-2' }), 'waited'),
    ];

    expect(
      detectLoops(history, signatures, {
        goals: [
          createGoal({
            id: 'monitor',
            title: 'Monitor',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['Complete monitoring'],
          }),
        ],
      }),
    ).toEqual({ loopDetected: false });
  });

  it('still detects stagnant wait iterations when the waits fail', () => {
    const signatures: IterationProgressSignature[] = [];
    const history: ToolCallRecord[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['wait']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'monitor', status: 'active', evidence: [] },
      ]),
      activeGoalId: 'monitor',
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

    expect(
      detectLoops(history, signatures, {
        goals: [
          createGoal({
            id: 'monitor',
            title: 'Monitor',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['Complete monitoring'],
          }),
        ],
      }),
    ).toMatchObject({
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
      activeGoalId: 'audit',
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

    expect(
      detectLoops(history, signatures, {
        goals: [
          createGoal({
            id: 'audit',
            title: 'Audit source packets',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['Produce a grounded audit'],
          }),
        ],
      }),
    ).toEqual({ loopDetected: false });
  });

  it('warns before stopping distinct file paths that return no new information', () => {
    const signatures: IterationProgressSignature[] = [];
    const history: ToolCallRecord[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['read_file']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'audit', status: 'active', evidence: [] },
      ]),
      activeGoalId: 'audit',
    };

    for (let index = 0; index < STAGNANT_PROGRESS_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
      history.push(
        rec('read_file', JSON.stringify({ path: `packets/missing-${index}.md` }), 'empty'),
      );
    }

    expect(
      detectLoops(history, signatures, {
        goals: [
          createGoal({
            id: 'audit',
            title: 'Audit source packets',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['Produce a grounded audit'],
          }),
        ],
      }),
    ).toMatchObject({
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
      activeGoalId: 'audit',
    };

    for (let index = 0; index < CRITICAL_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
      history.push(
        rec('read_file', JSON.stringify({ path: `packets/missing-${index}.md` }), 'empty'),
      );
    }

    expect(
      detectLoops(history, signatures, {
        goals: [
          createGoal({
            id: 'audit',
            title: 'Audit source packets',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['Produce a grounded audit'],
          }),
        ],
      }),
    ).toMatchObject({
      loopDetected: true,
      level: 'critical',
      type: 'stagnant_progress',
      count: CRITICAL_THRESHOLD,
    });
  });

  it('does not flag stagnant progress when goal evidence advances', () => {
    const signatures: IterationProgressSignature[] = [];
    const multisetKey = buildToolMultisetKey(['write_file', 'update_goals']);

    recordIterationProgressSignature(signatures, {
      toolMultisetKey: multisetKey,
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'gate-followup', status: 'active', evidence: ['write_file:one'] },
      ]),
      activeGoalId: 'gate-followup',
    });
    recordIterationProgressSignature(signatures, {
      toolMultisetKey: multisetKey,
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'gate-followup', status: 'active', evidence: ['write_file:one', 'write_file:two'] },
      ]),
      activeGoalId: 'gate-followup',
    });
    recordIterationProgressSignature(signatures, {
      toolMultisetKey: multisetKey,
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'gate-followup', status: 'active', evidence: ['write_file:one', 'write_file:two'] },
      ]),
      activeGoalId: 'gate-followup',
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

describe('detectGoalMutationStall', () => {
  it('detects unchanged goal progress during update_goals-only iterations when goals exist', () => {
    const signatures: IterationProgressSignature[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey([GOAL_BOOTSTRAP_TOOL_NAME]),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'scope-a', status: 'active', evidence: [] },
      ]),
      activeGoalId: 'scope-a',
    };

    for (let i = 0; i < GOAL_MUTATION_STALL_THRESHOLD; i += 1) {
      recordIterationProgressSignature(signatures, entry);
    }

    expect(detectGoalMutationStall(signatures)).toEqual({
      detected: true,
      count: GOAL_MUTATION_STALL_THRESHOLD,
    });
  });

  it('does not fire when non-goal tools are in the multiset', () => {
    const signatures: IterationProgressSignature[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey([GOAL_BOOTSTRAP_TOOL_NAME, 'memory_recall']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'scope-a', status: 'active', evidence: [] },
      ]),
      activeGoalId: 'scope-a',
    };

    for (let i = 0; i < GOAL_MUTATION_STALL_THRESHOLD; i += 1) {
      recordIterationProgressSignature(signatures, entry);
    }

    expect(detectGoalMutationStall(signatures)).toEqual({ detected: false });
  });
});

describe('detectGoalFocusThrash', () => {
  it('detects alternating active goal focus during update_goals-only iterations', () => {
    const signatures: IterationProgressSignature[] = [];
    const goalMutationKey = buildToolMultisetKey([GOAL_BOOTSTRAP_TOOL_NAME]);
    const focusSequence = ['scope-a', 'scope-b', 'scope-a', 'scope-b'] as const;

    for (const activeGoalId of focusSequence) {
      recordIterationProgressSignature(signatures, {
        toolMultisetKey: goalMutationKey,
        goalProgressFingerprint: buildGoalProgressFingerprint([
          {
            id: 'scope-a',
            status: activeGoalId === 'scope-a' ? 'active' : 'pending',
            evidence: [],
          },
          {
            id: 'scope-b',
            status: activeGoalId === 'scope-b' ? 'active' : 'pending',
            evidence: [],
          },
        ]),
        activeGoalId,
      });
    }

    expect(detectGoalFocusThrash(signatures)).toEqual({
      detected: true,
      count: GOAL_FOCUS_THRASH_THRESHOLD,
    });
  });
});

describe('detectGoalMutationErrorLoop', () => {
  it('detects consecutive update_goals validation failures', () => {
    const history = Array.from({ length: GOAL_MUTATION_STALL_THRESHOLD }, () =>
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"complete","goals":[{"id":"scope-b"}]}', 'opaque', 'failed'),
    );
    expect(detectGoalMutationErrorLoop(history)).toEqual({
      detected: true,
      count: GOAL_MUTATION_STALL_THRESHOLD,
    });
  });

  it('detects recent update_goals validation failures even when other tools are interleaved', () => {
    const history = [
      rec('write_file', '{"path":"status.txt"}', '{"ok":true}'),
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"complete","goals":[{"id":"scope-b"}]}', 'opaque', 'failed'),
      rec('write_file', '{"path":"status.txt"}', '{"ok":true}'),
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"complete","goals":[{"id":"scope-b"}]}', 'opaque', 'failed'),
      rec('device_status', '{}', '{"ok":true}'),
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"complete","goals":[{"id":"scope-b"}]}', 'opaque', 'failed'),
    ];

    expect(detectGoalMutationErrorLoop(history)).toEqual({
      detected: true,
      count: GOAL_MUTATION_STALL_THRESHOLD,
    });
  });
});

describe('detectGoalBootstrapStall', () => {
  it('does not fire when goals already exist', () => {
    const history = Array.from({ length: GOAL_BOOTSTRAP_STALL_THRESHOLD }, () =>
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"add"}', 'opaque', 'failed'),
    );
    expect(
      detectGoalBootstrapStall({
        goals: [createGoal({ id: 'g-1', title: 'seeded', status: 'active' })],
        history,
      }),
    ).toEqual({ detected: false });
  });

  it('detects identical bootstrap calls without goal creation', () => {
    const history = Array.from({ length: GOAL_BOOTSTRAP_STALL_THRESHOLD }, () =>
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"add","goals":[]}', '{"updated":0}'),
    );
    expect(detectGoalBootstrapStall({ goals: [], history })).toEqual({
      detected: true,
      count: GOAL_BOOTSTRAP_STALL_THRESHOLD,
    });
  });

  it('detects repeated bootstrap errors without goal creation', () => {
    const history = Array.from({ length: GOAL_BOOTSTRAP_STALL_THRESHOLD }, () =>
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"add"}', 'opaque', 'failed'),
    );
    expect(detectGoalBootstrapStall({ goals: [], history })).toEqual({
      detected: true,
      count: GOAL_BOOTSTRAP_STALL_THRESHOLD,
    });
  });

  it('allows bootstrap retries when arguments change', () => {
    const history = [
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"add","goals":[{"id":"a"}]}', '{"updated":0}'),
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"add","goals":[{"id":"b"}]}', '{"updated":0}'),
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"add","goals":[{"id":"c"}]}', '{"updated":0}'),
    ];
    expect(detectGoalBootstrapStall({ goals: [], history })).toEqual({ detected: false });
  });
});
