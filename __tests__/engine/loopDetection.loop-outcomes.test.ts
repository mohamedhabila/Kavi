import { GOAL_BOOTSTRAP_TOOL_NAME } from '../../src/engine/goals/bootstrap';
import { createGoal } from '../../src/engine/goals/types';
import { CRITICAL_THRESHOLD, ERROR_WARNING_THRESHOLD, GOAL_BOOTSTRAP_STALL_THRESHOLD, GOAL_MUTATION_STALL_THRESHOLD, STAGNANT_PROGRESS_THRESHOLD, TOOL_CALL_HISTORY_SIZE, WARNING_THRESHOLD, buildGoalProgressFingerprint, buildToolMultisetKey, detectConsecutiveBlockedPreflightCalls, detectLoops, PREFLIGHT_BLOCKED_LOOP_THRESHOLD, hashResult, recordIterationProgressSignature, recordToolCall, type IterationProgressSignature, type ToolCallRecord } from '../../src/engine/loopDetection';
const rec = (name: string, args: string, result?: string): ToolCallRecord => ({
  name,
  arguments: args,
  timestamp: Date.now(),
  result,
  resultHash: result !== undefined ? hashResult(result) : undefined,
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
