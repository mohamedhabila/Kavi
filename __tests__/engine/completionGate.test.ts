import { GOAL_BOOTSTRAP_TOOL_NAME } from '../../src/engine/goals/bootstrap';
import { evaluateCompletionGate } from '../../src/engine/graph/completionGate';
import type { AgentControlTurnDirectives } from '../../src/engine/graph/agentControlGraph';
import type { AgentGoal } from '../../src/types/agentRun';
import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';

const baseTurnDirectives: AgentControlTurnDirectives = {
  forceFinalText: false,
  requireWorkflowTool: false,
  incompleteFinalTextRecoveryCount: 0,
};

function createGoal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    id: 'g1',
    title: 'Build feature',
    status: 'pending',
    dependencies: [],
    evidence: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function createPendingOperation(
  overrides: Partial<TrackedAsyncOperation> = {},
): TrackedAsyncOperation {
  return {
    key: 'session:worker-1',
    kind: 'session',
    resourceId: 'worker-1',
    displayName: 'Worker 1',
    status: 'running',
    lastUpdatedByTool: 'sessions_spawn',
    updatedAt: 1000,
    monitorToolNames: ['sessions_wait'],
    waitToolName: 'sessions_wait',
    waitArgs: { sessionId: 'worker-1' },
    ...overrides,
  };
}

function buildBaseParams() {
  return {
    trackedOperations: new Map<string, TrackedAsyncOperation>(),
    pendingOperations: [] as TrackedAsyncOperation[],
    consecutivePendingAsyncNoToolTurns: 0,
    hasDraftContent: true,
    goals: [] as AgentGoal[],
    toolingEnabledForProvider: true,
    selectedToolCount: 2,
    forceTextThisTurn: false,
    fullContent: 'final answer',
    recoveryDirectives: baseTurnDirectives,
    completion: {
      completionStatus: 'complete' as const,
      finishReason: 'stop',
    },
    nextFinalizationMaxTokens: 4096,
  };
}

describe('completionGate', () => {
  it('holds for pending async work before goals or delivery checks', () => {
    const pendingOperation = createPendingOperation();
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [createGoal({ status: 'active' })],
      trackedOperations: new Map([[pendingOperation.key, pendingOperation]]),
      pendingOperations: [pendingOperation],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'async_waiting_finalization_hold',
      }),
    );
  });

  it('auto-completes active blocking goals when required evidence is satisfied', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME]),
      goals: [
        createGoal({
          status: 'active',
          successCriteria: ['evidence.prefix:write_file', 'evidence.min:1'],
          evidence: ['write_file:artifacts/e2e-follow-gate.txt'],
        }),
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'auto_complete_goals',
        reason: 'goal_evidence_satisfied',
        graphEvent: expect.objectContaining({
          type: 'GOALS_UPDATED',
          reason: 'completion_gate:auto_complete',
          goals: [
            expect.objectContaining({
              id: 'g1',
              status: 'completed',
            }),
          ],
        }),
      }),
    );
  });

  it('auto-completes delegation goals when worker evidence is satisfied even with update_goals on surface', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'sessions_spawn', 'sessions_wait']),
      goals: [
        createGoal({
          id: 'worker-chain',
          status: 'active',
          successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
          evidence: ['worker:e2e-worker:E2E-WORKER-CHAIN-77'],
        }),
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'auto_complete_goals',
        reason: 'delegation_evidence_satisfied',
        graphEvent: expect.objectContaining({
          type: 'GOALS_UPDATED',
          reason: 'completion_gate:auto_complete',
          goals: [
            expect.objectContaining({
              id: 'worker-chain',
              status: 'completed',
            }),
          ],
        }),
      }),
    );
  });

  it('auto-completes blocked delegation goals when worker evidence is satisfied', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'sessions_spawn', 'sessions_wait']),
      goals: [
        createGoal({
          id: 'worker-chain',
          status: 'blocked',
          successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
          evidence: ['worker:e2e-worker:E2E-WORKER-CHAIN-77'],
          blockedReason: 'gate:worker-chain:evidence.min:1',
        }),
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'auto_complete_goals',
        reason: 'delegation_evidence_satisfied',
      }),
    );
  });

  it('auto-completes blocked non-delegation goals when structural evidence is satisfied', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'calendar_events']),
      goals: [
        createGoal({
          id: 'calendar-direct',
          status: 'blocked',
          completionPolicy: 'blocking',
          successCriteria: [
            'evidence.json_field:0.allowsModifications:true',
            'evidence.json_field:status:created',
            'evidence.json_field:status:updated',
          ],
          evidence: [
            'calendar_list:[{"allowsModifications":true}]',
            'calendar_create_event:{"status":"created","eventId":"e2e-event-1"}',
            'calendar_update_event:{"status":"updated","eventId":"e2e-event-1"}',
          ],
          blockedReason: 'gate:calendar-direct:evidence.json_field:status:updated',
        }),
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'auto_complete_goals',
        reason: 'goal_evidence_satisfied',
        graphEvent: expect.objectContaining({
          type: 'GOALS_UPDATED',
          goals: [
            expect.objectContaining({
              id: 'calendar-direct',
              status: 'completed',
              blockedReason: undefined,
            }),
          ],
        }),
      }),
    );
  });

  it('auto-completes goals when evidence is satisfied but update_goals is not on the turn surface', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set(['write_file', 'read_file']),
      goals: [
        createGoal({
          status: 'active',
          successCriteria: ['evidence.prefix:write_file', 'evidence.min:1'],
          evidence: ['write_file:artifacts/e2e-follow-gate.txt'],
        }),
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'auto_complete_goals',
        reason: 'goal_evidence_satisfied',
        graphEvent: expect.objectContaining({
          type: 'GOALS_UPDATED',
          reason: 'completion_gate:auto_complete',
          goals: [
            expect.objectContaining({
              id: 'g1',
              status: 'completed',
            }),
          ],
        }),
      }),
    );
  });

  it('auto-completes goals when evidence is satisfied and the turn surface is empty', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolCount: 0,
      selectedToolNames: new Set(),
      goals: [
        createGoal({
          status: 'active',
          successCriteria: ['evidence.prefix:calendar_list', 'evidence.min:1'],
          evidence: ['calendar_list:[{"allowsModifications":true}]'],
        }),
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'auto_complete_goals',
        reason: 'goal_evidence_satisfied',
        graphEvent: expect.objectContaining({
          type: 'GOALS_UPDATED',
          goals: [
            expect.objectContaining({
              id: 'g1',
              status: 'completed',
            }),
          ],
        }),
      }),
    );
  });

  it('holds when blocking pending goals remain and tools are available', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [createGoal({ status: 'pending', completionPolicy: 'blocking' })],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'goals_incomplete',
        graphEvent: {
          type: 'FINALIZATION_HELD',
          reason: 'goals_incomplete',
        },
      }),
    );
    expect(decision.type === 'hold' ? decision.systemPrompts.join('\n') : '').toContain(
      '- [g1] Build feature',
    );
  });

  it('does not hold for default persistent active goals that lack success criteria', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME]),
      goals: [createGoal({ status: 'active' })],
    });

    expect(decision).toEqual({ type: 'ready' });
  });

  it('holds for explicit blocking active goals even without success criteria', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME]),
      goals: [createGoal({ status: 'active', completionPolicy: 'blocking' })],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'goals_incomplete',
      }),
    );
    expect(decision.type === 'hold' ? decision.systemPrompts.join('\n') : '').toContain(
      '- [g1] Build feature',
    );
  });

  it('does not expose pending goal criteria in hold prompts before activation', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME]),
      goals: [
        createGoal({
          id: 'active-memory',
          title: 'Track memory',
          status: 'active',
          completionPolicy: 'blocking',
        }),
        createGoal({
          id: 'future-artifact',
          title: 'Future artifact',
          status: 'pending',
          completionPolicy: 'blocking',
          dependencies: ['active-memory'],
          successCriteria: ['evidence.file_hash:artifacts/future.txt:sha256'],
        }),
      ],
    });

    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain('[future-artifact] Future artifact');
    expect(prompt).not.toContain('artifacts/future.txt');
    expect(prompt).toContain('[active-memory] Track memory');
  });

  it('ignores persistent goals with unmet criteria in completion gating', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [
        createGoal({
          status: 'active',
          completionPolicy: 'persistent',
          successCriteria: ['evidence.min:2'],
          evidence: ['read_file:content'],
        }),
      ],
    });

    expect(decision).toEqual({ type: 'ready' });
  });

  it('skips goal holds when tool recovery cannot run this turn', () => {
    const goals = [createGoal({ status: 'active' })];

    expect(
      evaluateCompletionGate({
        ...buildBaseParams(),
        goals,
        toolingEnabledForProvider: false,
      }),
    ).toEqual({ type: 'ready' });
    expect(
      evaluateCompletionGate({
        ...buildBaseParams(),
        goals,
        forceTextThisTurn: true,
      }),
    ).toEqual({ type: 'ready' });
  });

  it('continues incomplete final text when goals are complete', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [createGoal({ status: 'completed' })],
      fullContent: 'partial final answer',
      completion: {
        completionStatus: 'incomplete',
        finishReason: 'length',
      },
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'incomplete_delivery_continuation',
      }),
    );
    expect(decision.type === 'hold' ? decision.turnDirectives : undefined).toEqual(
      expect.objectContaining({
        forceFinalText: true,
        forcedTextReason: 'incomplete_delivery_continuation',
        incompleteFinalTextRecoveryCount: 1,
      }),
    );
  });

  it('holds when active goal evidence criteria are unmet', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [
        createGoal({
          status: 'active',
          successCriteria: ['evidence.min:2'],
          evidence: ['read_file:content'],
        }),
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'goal_evidence_incomplete',
        graphEvent: {
          type: 'FINALIZATION_HELD',
          reason: 'goal_evidence_incomplete',
        },
        missingRequiredEvidenceLabels: ['g1:evidence.min:2'],
      }),
    );
    expect(decision.type === 'hold' ? decision.systemPrompts.join('\n') : '').toContain(
      'Missing evidence criteria: g1:evidence.min:2',
    );
  });

  it('adds recent structured repair hints to evidence hold prompts', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [
        createGoal({
          status: 'active',
          description: 'Create a calendar event titled E2E Native Review, then update it.',
          successCriteria: ['evidence.tool:calendar_create_event'],
          evidence: [],
        }),
      ],
      toolCallHistory: [
        {
          name: 'calendar_create_event',
          arguments: '{"startDate":"2026-06-15T09:00:00"}',
          timestamp: 1,
          result: JSON.stringify({
            status: 'error',
            code: 'missing_required_argument',
            missingRequiredArguments: ['title', 'endDate'],
            repair: {
              retryable: true,
              code: 'missing_required_argument',
              missingFields: ['title', 'endDate'],
            },
          }),
        },
      ],
    });

    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain(
      '[g1] Build feature: Create a calendar event titled E2E Native Review, then update it.',
    );
    expect(prompt).toContain(
      'Recent tool repair hints: calendar_create_event: missing_required_argument fields title, endDate',
    );
    expect(prompt).toContain(
      'Retry failed tools using repair.expectedShape and valid top-level JSON arguments from the user request, graph goals, or prior tool outputs.',
    );
  });

  it('holds finalization after an unrepaired graph mutation error', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      toolCallHistory: [
        {
          id: 'tc-failed-goals',
          name: GOAL_BOOTSTRAP_TOOL_NAME,
          arguments: '{"action":"complete","id":"missing"}',
          timestamp: 1,
          result: JSON.stringify({
            status: 'error',
            action: 'complete',
            structuredErrors: [{ code: 'goal_not_found', goalId: 'missing' }],
            repair: {
              retryable: true,
              code: 'goal_not_found',
              expectedShape: {
                action: 'complete',
                id: '<stable-goal-id>',
                name: '<visible-goal-name>',
              },
            },
          }),
        },
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'graph_mutation_error',
        graphEvent: {
          type: 'FINALIZATION_HELD',
          reason: 'graph_mutation_error',
        },
      }),
    );
    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain('latest graph mutation failed');
    expect(prompt).toContain('update_goals: goal_not_found');
  });

  it('does not hold for graph mutation errors after a later successful graph mutation', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      toolCallHistory: [
        {
          id: 'tc-failed-goals',
          name: GOAL_BOOTSTRAP_TOOL_NAME,
          arguments: '{"action":"complete","id":"missing"}',
          timestamp: 1,
          result: JSON.stringify({ status: 'error' }),
        },
        {
          id: 'tc-ok-goals',
          name: GOAL_BOOTSTRAP_TOOL_NAME,
          arguments: '{"action":"add","id":"scope","name":"Scope"}',
          timestamp: 2,
          result: JSON.stringify({ status: 'ok' }),
        },
      ],
    });

    expect(decision).toEqual({ type: 'ready' });
  });

  it('holds once after a retryable non-graph tool error', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set(['tool_catalog', 'sms_compose']),
      toolCallHistory: [
        {
          id: 'tc-sms',
          name: 'sms_compose',
          arguments: '{"recipients":["Avery"],"message":"Hello"}',
          timestamp: 1,
          result: JSON.stringify({
            status: 'error',
            code: 'invalid_phone_number',
            repair: {
              retryable: true,
              code: 'invalid_phone_number',
              invalidFields: ['recipients'],
            },
          }),
        },
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'tool_error_repair',
        graphEvent: {
          type: 'FINALIZATION_HELD',
          reason: 'tool_error_repair',
        },
        nextConsecutivePendingAsyncNoToolTurns: 1,
      }),
    );
    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain('latest tool call failed');
    expect(prompt).toContain('sms_compose: invalid_phone_number fields recipients');
    expect(prompt).toContain('discovery tools');
  });

  it('does not repeatedly hold after the bounded retryable tool-error repair pass', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      consecutivePendingAsyncNoToolTurns: 1,
      goals: [],
      selectedToolNames: new Set(['tool_catalog', 'sms_compose']),
      toolCallHistory: [
        {
          id: 'tc-sms',
          name: 'sms_compose',
          arguments: '{"recipients":["Avery"],"message":"Hello"}',
          timestamp: 1,
          result: JSON.stringify({
            status: 'error',
            code: 'invalid_phone_number',
            repair: {
              retryable: true,
              code: 'invalid_phone_number',
              invalidFields: ['recipients'],
            },
          }),
        },
      ],
    });

    expect(decision).toEqual({ type: 'ready' });
  });

  it('holds for bounded workflow continuation when downstream tools remain', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set(['calendar_create_event', 'calendar_update_event']),
      pendingWorkflowContinuationToolNames: ['calendar_update_event'],
      toolCallHistory: [
        {
          id: 'tc-calendar-create',
          name: 'calendar_create_event',
          arguments: '{"title":"Review"}',
          timestamp: 1,
          result: JSON.stringify({ status: 'created', eventId: 'evt-1' }),
        },
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'workflow_continuation',
        graphEvent: {
          type: 'FINALIZATION_HELD',
          reason: 'workflow_continuation',
        },
        nextConsecutivePendingAsyncNoToolTurns: 1,
      }),
    );
    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain('downstream workflow tools');
    expect(prompt).toContain('calendar_update_event');
  });

  it('bounds workflow continuation after the second no-tool recovery pass', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      consecutivePendingAsyncNoToolTurns: 2,
      goals: [],
      selectedToolNames: new Set(['calendar_create_event', 'calendar_update_event']),
      pendingWorkflowContinuationToolNames: ['calendar_update_event'],
    });

    expect(decision).toEqual({ type: 'ready' });
  });

  it('holds once for substantial no-tool prose when discovery tools are available', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set(['tool_catalog', 'memory_recall']),
      toolCallHistory: [],
      fullContent:
        'I can verify this by checking the available device state and then recording the result. ' +
        'The answer depends on state outside the visible transcript, so I should not treat this as complete prose.',
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'no_tool_progress_retry',
        graphEvent: {
          type: 'FINALIZATION_HELD',
          reason: 'no_tool_progress_retry',
        },
        nextConsecutivePendingAsyncNoToolTurns: 1,
      }),
    );
  });

  it('does not hold short direct no-tool answers for discovery retry', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set(['tool_catalog', 'memory_recall']),
      toolCallHistory: [],
      fullContent: 'No problem.',
    });

    expect(decision).toEqual({ type: 'ready' });
  });

  it('holds once to reconcile successful external tool evidence into graph state', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'calendar_list', 'memory_remember']),
      toolCallHistory: [
        {
          id: 'tc-calendar',
          name: 'calendar_list',
          arguments: '{}',
          timestamp: 1,
          result: JSON.stringify([{ id: 'default', allowsModifications: true }]),
        },
        {
          id: 'tc-memory',
          name: 'memory_remember',
          arguments: '{"predicate":"calendar_modifiable"}',
          timestamp: 2,
          result: JSON.stringify({ status: 'remembered' }),
        },
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'graph_state_reconciliation',
        graphEvent: {
          type: 'FINALIZATION_HELD',
          reason: 'graph_state_reconciliation',
        },
        nextConsecutivePendingAsyncNoToolTurns: 1,
      }),
    );
    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain('control graph has no recorded goal state');
    expect(prompt).toContain('call update_goals');
  });

  it('does not repeat graph reconciliation after the bounded retry pass', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      consecutivePendingAsyncNoToolTurns: 1,
      goals: [],
      selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'calendar_list', 'memory_remember']),
      toolCallHistory: [
        {
          id: 'tc-calendar',
          name: 'calendar_list',
          arguments: '{}',
          timestamp: 1,
          result: JSON.stringify([{ id: 'default', allowsModifications: true }]),
        },
        {
          id: 'tc-memory',
          name: 'memory_remember',
          arguments: '{"predicate":"calendar_modifiable"}',
          timestamp: 2,
          result: JSON.stringify({ status: 'remembered' }),
        },
      ],
    });

    expect(decision).toEqual({ type: 'ready' });
  });

  it('does not reconcile graph state for failed, graph-only, or single work-tool history', () => {
    expect(
      evaluateCompletionGate({
        ...buildBaseParams(),
        goals: [],
        selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'calendar_list']),
        toolCallHistory: [
          {
            id: 'tc-catalog',
            name: 'tool_catalog',
            arguments: '{}',
            timestamp: 1,
            result: JSON.stringify({ status: 'ok' }),
          },
          {
            id: 'tc-calendar',
            name: 'calendar_list',
            arguments: '{}',
            timestamp: 2,
            result: JSON.stringify([{ id: 'default', allowsModifications: true }]),
          },
        ],
      }),
    ).toEqual({ type: 'ready' });

    expect(
      evaluateCompletionGate({
        ...buildBaseParams(),
        goals: [],
        selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'calendar_list']),
        toolCallHistory: [
          {
            id: 'tc-calendar',
            name: 'calendar_list',
            arguments: '{}',
            timestamp: 1,
            result: 'Error: calendar unavailable',
          },
        ],
      }),
    ).toEqual({ type: 'ready' });

    expect(
      evaluateCompletionGate({
        ...buildBaseParams(),
        goals: [],
        selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME]),
        toolCallHistory: [
          {
            id: 'tc-goals',
            name: GOAL_BOOTSTRAP_TOOL_NAME,
            arguments: '{"action":"add","id":"g1"}',
            timestamp: 1,
            result: JSON.stringify({ status: 'ok' }),
          },
        ],
      }),
    ).toEqual({ type: 'ready' });
  });

  it('holds when evidence.tool criteria are unmet', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [
        createGoal({
          status: 'active',
          successCriteria: ['evidence.tool:write_file'],
          evidence: ['read_file:config.json'],
        }),
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'goal_evidence_incomplete',
        missingRequiredEvidenceLabels: ['g1:evidence.tool:write_file'],
      }),
    );
  });

  it('keeps missing evidence as a continuation condition in hold prompts', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [
        createGoal({
          status: 'active',
          successCriteria: ['evidence.tool:write_file'],
          evidence: [],
        }),
      ],
    });

    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain('Missing evidence criteria: g1:evidence.tool:write_file');
    expect(prompt).toContain('Continue executing until required goal evidence is recorded');
    expect(prompt).not.toContain('blockedReason');
  });

  it('returns ready when no blockers remain', () => {
    expect(
      evaluateCompletionGate({
        ...buildBaseParams(),
        goals: [createGoal({ status: 'completed' })],
      }),
    ).toEqual({ type: 'ready' });
  });
});
