import { GOAL_BOOTSTRAP_TOOL_NAME } from '../../src/engine/goals/bootstrap';
import { createGoal } from '../../src/engine/goals/types';
import { ERROR_WARNING_THRESHOLD, GOAL_BOOTSTRAP_STALL_THRESHOLD, GOAL_MUTATION_STALL_THRESHOLD, STAGNANT_PROGRESS_THRESHOLD, WARNING_THRESHOLD, buildGoalProgressFingerprint, buildToolMultisetKey, detectGenericRepeat, detectGoalBootstrapStall, detectGoalFocusThrash, detectGoalMutationErrorLoop, detectGoalMutationStall, GOAL_FOCUS_THRASH_THRESHOLD, detectRepeatedErrors, detectStagnantProgress, hashResult, recordIterationProgressSignature, type IterationProgressSignature, type ToolCallRecord } from '../../src/engine/loopDetection';
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
      rec('web_fetch', '{"urls":["https://example.com"]}', 'Error: timeout'),
      rec('web_fetch', '{"urls":["https://example.com"]}', 'Error: timeout'),
    ];
    expect(detectRepeatedErrors(history)).toEqual({
      detected: true,
      tool: 'web_fetch',
      count: ERROR_WARNING_THRESHOLD,
    });
  });

  it('ignores successful repeated calls', () => {
    const history = [
      rec('web_fetch', '{"urls":["https://example.com"]}', 'ok'),
      rec('web_fetch', '{"urls":["https://example.com"]}', 'ok'),
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
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"complete","goals":[{"id":"scope-b"}]}', 'Error: validation failed'),
    );
    expect(detectGoalMutationErrorLoop(history)).toEqual({
      detected: true,
      count: GOAL_MUTATION_STALL_THRESHOLD,
    });
  });

  it('detects recent update_goals validation failures even when other tools are interleaved', () => {
    const history = [
      rec('write_file', '{"path":"status.txt"}', '{"ok":true}'),
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"complete","goals":[{"id":"scope-b"}]}', 'Error: validation failed'),
      rec('write_file', '{"path":"status.txt"}', '{"ok":true}'),
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"complete","goals":[{"id":"scope-b"}]}', 'Error: validation failed'),
      rec('device_status', '{}', '{"ok":true}'),
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"complete","goals":[{"id":"scope-b"}]}', 'Error: validation failed'),
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
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"add"}', 'Error: invalid payload'),
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
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"add"}', 'Error: invalid payload'),
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
