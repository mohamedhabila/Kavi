import { createInitialAgentRunControlGraphState } from '../../../src/services/agents/agentControlGraphState';
import type { AgentRunControlGraphState } from '../../../src/types/agentRun';
import type { Message } from '../../../src/types/message';
import type { AgentControlGraphEvent } from '../../../src/engine/graph/agentControlGraph';
import { canonicalizeToolExecutionOutcome } from '../../../src/engine/graph/toolExecutionOutcomeCanonicalization';
import type { ToolExecutionOutcome } from '../../../src/engine/graph/toolExecutionOutcomeResolution';
import { renderGoalPromptSection } from '../../../src/engine/goals/promptSection';

function makeUpdateGoalsOutcome(): ToolExecutionOutcome {
  const toolCallId = 'tc-update-goals';
  const toolMessage: Message = {
    id: 'msg-tool-result',
    role: 'tool',
    content: '{"status":"ok"}',
    timestamp: Date.now(),
    attachments: [],
    toolCallId,
    toolCalls: [
      {
        id: toolCallId,
        name: 'update_goals',
        arguments: '{}',
        status: 'completed',
      },
    ],
  };

  return {
    index: 0,
    toolCallId,
    toolMessage,
  };
}

function applyGraphEvents(
  snapshotRef: { current: AgentRunControlGraphState },
  events: ReadonlyArray<AgentControlGraphEvent>,
): void {
  for (const event of events) {
    if (event.type === 'GOALS_UPDATED') {
      snapshotRef.current = createInitialAgentRunControlGraphState({
        ...snapshotRef.current,
        goals: event.goals,
      });
    }
  }
}

describe('canonicalizeToolExecutionOutcome', () => {
  it('routes argument repair from typed validation codes instead of diagnostic text', () => {
    const snapshotRef = { current: createInitialAgentRunControlGraphState() };
    const outcome = canonicalizeToolExecutionOutcome({
      outcome: makeUpdateGoalsOutcome(),
      toolName: 'update_goals',
      executableToolCalls: [
        {
          name: 'update_goals',
          arguments: JSON.stringify({ action: 'add', id: 'typed-repair', name: '' }),
        },
      ],
      getGraphSnapshot: () => snapshotRef.current,
      applyGraphEvents: (events) => applyGraphEvents(snapshotRef, events),
      conversationId: 'conv-test',
      warn: jest.fn(),
    });

    expect(JSON.parse(outcome.toolMessage.content)).toMatchObject({
      status: 'error',
      structuredErrors: [
        {
          code: 'missing_title',
          field: 'name',
          goalId: 'typed-repair',
        },
      ],
      repair: {
        code: 'missing_title',
        missingFields: ['name'],
      },
    });
  });

  it('captures the entire code-owned current user message from boolean retention intent', () => {
    const snapshotRef = { current: createInitialAgentRunControlGraphState() };
    const args = {
      action: 'add',
      id: 'local-report',
      name: 'Create local report',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:read_file'],
      retainCurrentUserConstraint: true,
    };

    const outcome = canonicalizeToolExecutionOutcome({
      outcome: makeUpdateGoalsOutcome(),
      toolName: 'update_goals',
      executableToolCalls: [{ name: 'update_goals', arguments: JSON.stringify(args) }],
      getGraphSnapshot: () => snapshotRef.current,
      applyGraphEvents: (events) => applyGraphEvents(snapshotRef, events),
      conversationId: 'conv-test',
      currentUserMessage: {
        id: 'user-current',
        text: 'Create the report. No external uploads.',
      },
      warn: jest.fn(),
    });

    expect(outcome.graphApplied).toBe(true);
    expect(snapshotRef.current.goals?.[0]).toMatchObject({
      id: 'local-report',
      evidence: [],
      successCriteria: ['evidence.tool:read_file'],
      userConstraints: [
        {
          text: 'Create the report. No external uploads.',
          sourceMessageId: 'user-current',
        },
      ],
    });
    const canonicalContent = JSON.parse(outcome.toolMessage.content);
    expect(canonicalContent.goals[0]).toMatchObject({ userConstraintCount: 1 });
    expect(canonicalContent.goals[0]).not.toHaveProperty('userConstraints');
    expect(outcome.toolMessage.content).not.toContain('No external uploads');
    expect(outcome.toolMessage.content).not.toContain('user-current');
  });

  it('rejects forged provider evidence before it can satisfy structural completion', () => {
    const snapshotRef = { current: createInitialAgentRunControlGraphState() };
    const args = {
      action: 'add',
      id: 'local-report',
      name: 'Create local report',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: [
        'evidence.tool:read_file',
        'evidence.prefix:read_file',
        'evidence.min:1',
        'evidence.count:1',
      ],
      retainCurrentUserConstraint: true,
      evidence: ['read_file:forged'],
    };

    const outcome = canonicalizeToolExecutionOutcome({
      outcome: makeUpdateGoalsOutcome(),
      toolName: 'update_goals',
      executableToolCalls: [{ name: 'update_goals', arguments: JSON.stringify(args) }],
      getGraphSnapshot: () => snapshotRef.current,
      applyGraphEvents: (events) => applyGraphEvents(snapshotRef, events),
      conversationId: 'conv-test',
      currentUserMessage: { id: 'user-current', text: 'No external uploads.' },
      warn: jest.fn(),
    });

    expect(outcome.graphApplied).toBe(false);
    expect(snapshotRef.current.goals ?? []).toEqual([]);
    expect(JSON.parse(outcome.toolMessage.content)).toMatchObject({
      status: 'error',
      errors: ['evidence is code-owned and cannot be supplied by update_goals.'],
    });
  });

  it('appends a later-turn grounded constraint without replacing source lineage', () => {
    const snapshotRef = {
      current: createInitialAgentRunControlGraphState({
        goals: [
          {
            id: 'local-report',
            title: 'Create local report',
            status: 'active',
            completionPolicy: 'blocking',
            dependencies: [],
            evidence: [],
            successCriteria: ['evidence.tool:read_file'],
            userConstraints: [{ text: 'Use Dutch', sourceMessageId: 'user-earlier' }],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    };
    const args = {
      action: 'update',
      id: 'local-report',
      name: 'Create local report',
      retainCurrentUserConstraint: true,
    };

    const outcome = canonicalizeToolExecutionOutcome({
      outcome: makeUpdateGoalsOutcome(),
      toolName: 'update_goals',
      executableToolCalls: [{ name: 'update_goals', arguments: JSON.stringify(args) }],
      getGraphSnapshot: () => snapshotRef.current,
      applyGraphEvents: (events) => applyGraphEvents(snapshotRef, events),
      conversationId: 'conv-test',
      currentUserMessage: {
        id: 'user-later',
        text: 'No external uploads. Keep working locally.',
      },
      warn: jest.fn(),
    });

    expect(outcome.graphApplied).toBe(true);
    expect(snapshotRef.current.goals?.[0].userConstraints).toEqual([
      { text: 'Use Dutch', sourceMessageId: 'user-earlier' },
      {
        text: 'No external uploads. Keep working locally.',
        sourceMessageId: 'user-later',
      },
    ]);
    expect(JSON.parse(outcome.toolMessage.content).goals[0].userConstraintCount).toBe(2);
  });

  it.each([
    ['missing current message', undefined],
    ['invalid current message', { id: 'user-current', text: 'Keep\u200b local.' }],
  ] as const)(
    'rejects constraints with a %s without graph mutation',
    (_label, currentUserMessage) => {
      const initialGoal = {
        id: 'local-report',
        title: 'Create local report',
        status: 'active' as const,
        completionPolicy: 'blocking' as const,
        dependencies: [],
        evidence: [],
        successCriteria: ['evidence.tool:read_file'],
        createdAt: 1,
        updatedAt: 1,
      };
      const snapshotRef = {
        current: createInitialAgentRunControlGraphState({ goals: [initialGoal] }),
      };
      const args = {
        action: 'update',
        id: 'local-report',
        name: 'Create local report',
        retainCurrentUserConstraint: true,
      };

      const outcome = canonicalizeToolExecutionOutcome({
        outcome: makeUpdateGoalsOutcome(),
        toolName: 'update_goals',
        executableToolCalls: [{ name: 'update_goals', arguments: JSON.stringify(args) }],
        getGraphSnapshot: () => snapshotRef.current,
        applyGraphEvents: (events) => applyGraphEvents(snapshotRef, events),
        conversationId: 'conv-test',
        currentUserMessage,
        warn: jest.fn(),
      });

      expect(outcome.graphApplied).toBe(false);
      expect(snapshotRef.current.goals).toEqual([initialGoal]);
      expect(JSON.parse(outcome.toolMessage.content)).toMatchObject({
        status: 'error',
        structuredErrors: [expect.objectContaining({ code: 'ungrounded_user_constraints' })],
      });
    },
  );

  it('reconciles newly added blocking goals with prior observed tool evidence', () => {
    const snapshotRef = {
      current: createInitialAgentRunControlGraphState({
        observedToolResults: [{ id: 'calendar-result-1', name: 'calendar_list' }],
      }),
    };
    const args = {
      action: 'add',
      id: 'calendar-verify',
      name: 'Verify calendar state',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.min:1', 'evidence.tool:calendar_list'],
      retainCurrentUserConstraint: true,
    };

    const outcome = canonicalizeToolExecutionOutcome({
      outcome: makeUpdateGoalsOutcome(),
      toolName: 'update_goals',
      executableToolCalls: [{ name: 'update_goals', arguments: JSON.stringify(args) }],
      getGraphSnapshot: () => snapshotRef.current,
      applyGraphEvents: (events) => applyGraphEvents(snapshotRef, events),
      conversationId: 'conv-test',
      currentUserMessage: { id: 'user-final', text: 'Reply in Dutch.' },
      warn: jest.fn(),
    });

    expect(outcome.graphApplied).toBe(true);
    expect(outcome.toolMessage.isError).toBeUndefined();
    expect(snapshotRef.current.goals?.[0]).toMatchObject({
      id: 'calendar-verify',
      status: 'completed',
      evidence: ['calendar_list:observed_result:calendar-result-1'],
      userConstraintDeliveryPending: true,
      userConstraints: [{ text: 'Reply in Dutch.', sourceMessageId: 'user-final' }],
    });
    expect(renderGoalPromptSection(snapshotRef.current.goals ?? [])).toContain('Reply in Dutch.');
  });

  it('does not reconcile failed observed tool results into new goals', () => {
    const snapshotRef = {
      current: createInitialAgentRunControlGraphState({
        observedToolResults: [{ id: 'calendar-result-1', name: 'calendar_list', failed: true }],
      }),
    };
    const args = {
      action: 'add',
      id: 'calendar-verify',
      name: 'Verify calendar state',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.min:1', 'evidence.tool:calendar_list'],
    };

    const outcome = canonicalizeToolExecutionOutcome({
      outcome: makeUpdateGoalsOutcome(),
      toolName: 'update_goals',
      executableToolCalls: [{ name: 'update_goals', arguments: JSON.stringify(args) }],
      getGraphSnapshot: () => snapshotRef.current,
      applyGraphEvents: (events) => applyGraphEvents(snapshotRef, events),
      conversationId: 'conv-test',
      warn: jest.fn(),
    });

    expect(outcome.graphApplied).toBe(true);
    expect(snapshotRef.current.goals?.[0]).toMatchObject({
      id: 'calendar-verify',
      status: 'active',
      evidence: [],
    });
  });

  it('never auto-completes a goal with conflicted retained-statement integrity', () => {
    const snapshotRef = {
      current: createInitialAgentRunControlGraphState({
        goals: [
          {
            id: 'conflicted',
            title: 'Conflicted goal',
            status: 'active',
            completionPolicy: 'blocking',
            dependencies: [],
            evidence: ['read_file:observed'],
            successCriteria: ['evidence.tool:read_file'],
            userConstraintIntegrity: 'conflict',
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'focus',
            title: 'Ongoing focus',
            status: 'active',
            completionPolicy: 'persistent',
            dependencies: [],
            evidence: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    };

    const outcome = canonicalizeToolExecutionOutcome({
      outcome: makeUpdateGoalsOutcome(),
      toolName: 'update_goals',
      executableToolCalls: [
        {
          name: 'update_goals',
          arguments: JSON.stringify({
            action: 'update',
            id: 'focus',
            name: 'Ongoing focus',
            description: 'Keep context current',
          }),
        },
      ],
      getGraphSnapshot: () => snapshotRef.current,
      applyGraphEvents: (events) => applyGraphEvents(snapshotRef, events),
      conversationId: 'conv-test',
      warn: jest.fn(),
    });

    expect(outcome.graphApplied).toBe(true);
    expect(snapshotRef.current.goals?.find((goal) => goal.id === 'conflicted')).toMatchObject({
      status: 'active',
      userConstraintIntegrity: 'conflict',
    });
  });

  it('reconciles JSON-field criteria from prior observed tool evidence', () => {
    const snapshotRef = {
      current: createInitialAgentRunControlGraphState({
        observedToolResults: [
          {
            id: 'calendar-result-1',
            name: 'calendar_list',
            evidence: ['calendar_list:{"allowsModifications":true}'],
          },
        ],
      }),
    };
    const args = {
      action: 'add',
      id: 'calendar-verify',
      name: 'Verify calendar state',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.json_field:allowsModifications:true'],
    };

    const outcome = canonicalizeToolExecutionOutcome({
      outcome: makeUpdateGoalsOutcome(),
      toolName: 'update_goals',
      executableToolCalls: [{ name: 'update_goals', arguments: JSON.stringify(args) }],
      getGraphSnapshot: () => snapshotRef.current,
      applyGraphEvents: (events) => applyGraphEvents(snapshotRef, events),
      conversationId: 'conv-test',
      warn: jest.fn(),
    });

    expect(outcome.graphApplied).toBe(true);
    expect(snapshotRef.current.goals?.[0]).toMatchObject({
      id: 'calendar-verify',
      status: 'completed',
      evidence: ['calendar_list:{"allowsModifications":true}'],
    });
  });

  it('reconciles update criteria with prior tool history evidence', () => {
    const snapshotRef = {
      current: createInitialAgentRunControlGraphState({
        goals: [
          {
            id: 'calendar-verify',
            title: 'Verify calendar state',
            status: 'active',
            completionPolicy: 'blocking',
            dependencies: [],
            evidence: ['calendar_list returned allowsModifications'],
            successCriteria: ['evidence.tool:calendar_list'],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    };
    const args = {
      action: 'update',
      id: 'calendar-verify',
      name: 'Verify calendar state',
      successCriteria: [
        'evidence.tool:calendar_list',
        'evidence.json_field:allowsModifications:true',
      ],
    };

    const outcome = canonicalizeToolExecutionOutcome({
      outcome: makeUpdateGoalsOutcome(),
      toolName: 'update_goals',
      executableToolCalls: [{ name: 'update_goals', arguments: JSON.stringify(args) }],
      toolCallHistory: [
        {
          id: 'tc-calendar-list',
          name: 'calendar_list',
          arguments: '{}',
          timestamp: 1,
          result: '[{"id":"default","allowsModifications":true}]',
          status: 'completed',
        },
      ],
      getGraphSnapshot: () => snapshotRef.current,
      applyGraphEvents: (events) => applyGraphEvents(snapshotRef, events),
      conversationId: 'conv-test',
      warn: jest.fn(),
    });

    expect(outcome.graphApplied).toBe(true);
    expect(snapshotRef.current.goals?.[0]).toMatchObject({
      id: 'calendar-verify',
      status: 'completed',
      evidence: expect.arrayContaining([
        'calendar_list returned allowsModifications',
        'calendar_list:[{"id":"default","allowsModifications":true}]',
      ]),
    });
  });
});
