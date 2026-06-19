import { GOAL_BOOTSTRAP_TOOL_NAME } from '../../src/engine/goals/bootstrap';
import { createGoal } from '../../src/engine/goals/types';
import {
  CRITICAL_THRESHOLD,
  ERROR_WARNING_THRESHOLD,
  GOAL_BOOTSTRAP_STALL_THRESHOLD,
  GOAL_MUTATION_STALL_THRESHOLD,
  STAGNANT_PROGRESS_THRESHOLD,
  TOOL_CALL_HISTORY_SIZE,
  WARNING_THRESHOLD,
  buildGoalProgressFingerprint,
  buildToolMultisetKey,
  detectConsecutiveBlockedPreflightCalls,
  detectGenericRepeat,
  detectGoalBootstrapStall,
  detectGoalFocusThrash,
  detectGoalMutationErrorLoop,
  detectGoalMutationStall,
  detectLoops,
  GOAL_FOCUS_THRASH_THRESHOLD,
  detectRepeatedErrors,
  detectStagnantProgress,
  PREFLIGHT_BLOCKED_LOOP_THRESHOLD,
  hashResult,
  recordIterationProgressSignature,
  recordToolCall,
  type IterationProgressSignature,
  type ToolCallRecord,
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

describe('detectLoops', () => {
  it('returns no loop for empty history', () => {
    expect(detectLoops([])).toEqual({ loopDetected: false });
  });

  it('escalates bootstrap stall to critical when goals are absent', () => {
    const history = Array.from({ length: GOAL_BOOTSTRAP_STALL_THRESHOLD }, () =>
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"add"}', 'Error: invalid payload'),
    );
    expect(detectLoops(history, [], { goals: [] })).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'bootstrap_stall',
        count: GOAL_BOOTSTRAP_STALL_THRESHOLD,
      }),
    );
  });

  it('does not infer bootstrap stall without explicit graph goal context', () => {
    const history = Array.from({ length: GOAL_BOOTSTRAP_STALL_THRESHOLD }, () =>
      rec(GOAL_BOOTSTRAP_TOOL_NAME, '{"action":"add"}', 'Error: invalid payload'),
    ).map((entry) => ({ ...entry, preflightBlockedKind: 'tool_filter' as const }));

    expect(detectLoops(history)).toEqual(
      expect.objectContaining({
        loopDetected: true,
        type: 'tool_filter_loop',
      }),
    );
  });

  it('detects consecutive preflight blocked tool_filter calls at threshold 3', () => {
    const history = Array.from({ length: PREFLIGHT_BLOCKED_LOOP_THRESHOLD }, () =>
      rec('update_goals', '{}', 'Tool "update_goals" is not allowed in this context.'),
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
      ),
    ).map((entry) => ({ ...entry, preflightBlockedKind: 'schema_validation' as const }));

    expect(detectConsecutiveBlockedPreflightCalls(history)).toEqual({
      detected: true,
      kind: 'schema_validation',
      count: PREFLIGHT_BLOCKED_LOOP_THRESHOLD,
    });
    expect(
      detectLoops(history, [], {
        goals: [
          createGoal({
            title: 'calendar mutation',
            status: 'active',
            completionPolicy: 'blocking',
          }),
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'tool_filter_loop',
        count: PREFLIGHT_BLOCKED_LOOP_THRESHOLD,
      }),
    );
  });

  it('downgrades preflight filter loops when only persistent focus goals remain', () => {
    const history = Array.from({ length: PREFLIGHT_BLOCKED_LOOP_THRESHOLD }, () =>
      rec('tool_catalog', '{}', 'Tool "tool_catalog" is not allowed in this context.'),
    ).map((entry) => ({ ...entry, preflightBlockedKind: 'tool_filter' as const }));

    expect(
      detectLoops(history, [], {
        goals: [
          createGoal({
            id: 'scope-b',
            title: 'scope-b-planning',
            status: 'active',
            completionPolicy: 'persistent',
          }),
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'warning',
        type: 'tool_filter_loop',
        count: PREFLIGHT_BLOCKED_LOOP_THRESHOLD,
      }),
    );
  });

  it('changes goal progress fingerprint when a new goal id is added', () => {
    const before = buildGoalProgressFingerprint([
      { id: 'scope-a', status: 'active', evidence: [] },
    ]);
    const after = buildGoalProgressFingerprint([
      { id: 'scope-a', status: 'pending', evidence: [] },
      { id: 'scope-b', status: 'active', evidence: [] },
    ]);

    expect(before).not.toBe(after);
    expect(after.startsWith('scope-a,scope-b|')).toBe(true);
  });

  it('escalates goal mutation stall to critical when blocking goals are incomplete', () => {
    const signatures: IterationProgressSignature[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey([GOAL_BOOTSTRAP_TOOL_NAME]),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'scope-a', status: 'active', evidence: [] },
        { id: 'scope-b', status: 'pending', evidence: [] },
      ]),
      activeGoalId: 'scope-a',
    };
    for (let i = 0; i < GOAL_MUTATION_STALL_THRESHOLD; i += 1) {
      recordIterationProgressSignature(signatures, entry);
    }

    expect(
      detectLoops([], signatures, {
        goals: [
          createGoal({
            id: 'scope-a',
            title: 'A',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['evidence.prefix:write_file'],
          }),
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'goal_mutation_stall',
        count: GOAL_MUTATION_STALL_THRESHOLD,
      }),
    );
  });

  it('warns for goal mutation stall when only persistent focus goals are live', () => {
    const signatures: IterationProgressSignature[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey([GOAL_BOOTSTRAP_TOOL_NAME]),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'scope-a', status: 'pending', evidence: [] },
        { id: 'scope-b', status: 'active', evidence: [] },
      ]),
      activeGoalId: 'scope-b',
    };
    for (let i = 0; i < GOAL_MUTATION_STALL_THRESHOLD; i += 1) {
      recordIterationProgressSignature(signatures, entry);
    }

    expect(
      detectLoops([], signatures, {
        goals: [
          createGoal({
            id: 'scope-a',
            title: 'A',
            status: 'pending',
            completionPolicy: 'persistent',
          }),
          createGoal({
            id: 'scope-b',
            title: 'B',
            status: 'active',
            completionPolicy: 'persistent',
          }),
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'warning',
        type: 'goal_mutation_stall',
        count: GOAL_MUTATION_STALL_THRESHOLD,
      }),
    );
  });

  it('escalates goal mutation validation error loops while blocking goals are incomplete', () => {
    const history = Array.from({ length: GOAL_MUTATION_STALL_THRESHOLD }, (_value, index) =>
      rec(
        GOAL_BOOTSTRAP_TOOL_NAME,
        `{"action":"complete","goals":[{"id":"scope-a","attempt":${index}}]}`,
        `Error: validation failed ${index}`,
      ),
    );

    expect(
      detectLoops(history, [], {
        goals: [
          createGoal({
            id: 'scope-a',
            title: 'A',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['evidence.prefix:write_file'],
          }),
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'critical',
        type: 'goal_mutation_stall',
        count: GOAL_MUTATION_STALL_THRESHOLD,
      }),
    );
  });

  it('warns for goal mutation validation error loops after blocking goals are complete', () => {
    const history = Array.from({ length: GOAL_MUTATION_STALL_THRESHOLD }, (_value, index) =>
      rec(
        GOAL_BOOTSTRAP_TOOL_NAME,
        `{"action":"add","goals":[{"id":"stale-${index}"}]}`,
        `Error: validation failed ${index}`,
      ),
    );

    expect(
      detectLoops(history, [], {
        goals: [
          createGoal({
            id: 'scope-a',
            title: 'A',
            status: 'completed',
            completionPolicy: 'blocking',
            successCriteria: ['evidence.prefix:write_file'],
            evidence: ['write_file:done'],
          }),
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'warning',
        type: 'goal_mutation_stall',
        count: GOAL_MUTATION_STALL_THRESHOLD,
      }),
    );
  });

  it('escalates stagnant progress to critical for pre-tool deny', () => {
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
      goalProgressFingerprint: '',
      activeGoalId: null,
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

  it('warns for stagnant progress when blocking goals are complete', () => {
    const signatures: IterationProgressSignature[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['memory_search']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'memory-action', status: 'completed', evidence: ['memory_remember:done'] },
      ]),
      activeGoalId: null,
    };
    for (let i = 0; i < STAGNANT_PROGRESS_THRESHOLD; i += 1) {
      recordIterationProgressSignature(signatures, entry);
    }

    expect(
      detectLoops([], signatures, {
        goals: [
          createGoal({
            id: 'memory-action',
            title: 'Memory action',
            status: 'completed',
            completionPolicy: 'blocking',
            successCriteria: ['evidence.prefix:memory_remember'],
            evidence: ['memory_remember:done'],
          }),
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'warning',
        type: 'stagnant_progress',
        count: STAGNANT_PROGRESS_THRESHOLD,
      }),
    );
  });

  it('warns for stagnant progress when active blocking goals already satisfy evidence', () => {
    const signatures: IterationProgressSignature[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['calendar_events']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        {
          id: 'calendar-direct',
          status: 'active',
          evidence: [
            'calendar_list:[{"allowsModifications":true}]',
            'calendar_create_event:{"status":"created"}',
            'calendar_update_event:{"status":"updated"}',
          ],
        },
      ]),
      activeGoalId: 'calendar-direct',
    };
    for (let i = 0; i < STAGNANT_PROGRESS_THRESHOLD; i += 1) {
      recordIterationProgressSignature(signatures, entry);
    }

    expect(
      detectLoops([], signatures, {
        goals: [
          createGoal({
            id: 'calendar-direct',
            title: 'Calendar direct',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: [
              'evidence.json_field:0.allowsModifications:true',
              'evidence.json_field:status:created',
              'evidence.json_field:status:updated',
            ],
            evidence: [
              'calendar_list:[{"allowsModifications":true}]',
              'calendar_create_event:{"status":"created"}',
              'calendar_update_event:{"status":"updated"}',
            ],
          }),
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        loopDetected: true,
        level: 'warning',
        type: 'stagnant_progress',
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
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'gate-followup', status: 'active', evidence: ['read_file:same.txt'] },
      ]),
      activeGoalId: 'gate-followup',
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
      rec('web_fetch', '{"urls":["https://example.com"]}', 'Error: timeout'),
      rec('web_fetch', '{"urls":["https://example.com"]}', 'Error: timeout'),
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
      rec('web_search', '{"queries":["official docs"]}', '{"provider":"brave","searches":[{"query":"official docs","results":[]}]}'),
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
      rec('web_search', '{"queries":["official docs"]}', '{"provider":"brave","searches":[{"query":"official docs","results":[]}]}'),
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
