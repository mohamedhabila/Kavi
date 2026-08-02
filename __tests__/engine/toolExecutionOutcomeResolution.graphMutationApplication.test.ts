import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import {
  buildEffectCompletionCriterion,
  buildToolEffectReceiptEvidence,
} from '../../src/engine/goals/effectCompletionEvidence';
import {
  CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
  type AgentGoal,
} from '../../src/engine/goals/types';
import type { ToolEffectReceipt } from '../../src/types/toolEffectReceipt';
import {
  applyGoalGraphEvents,
  buildBaseParams,
  createGoal,
  createToolMessage,
  extractGoalEvidenceEvents,
  tool,
} from '../helpers/toolExecutionOutcomeHarness';

describe('tool execution outcome resolution', () => {
  it('reconciles and completes new goal criteria with existing graph evidence', async () => {
    const params = buildBaseParams();
    const priorEvidence = 'sms_compose:{"status":"sms_composer_opened","recipientCount":1}';
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        createGoal({
          id: 'mobile-action',
          status: 'completed',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.tool:sms_compose'],
          evidence: [priorEvidence],
        }),
      ],
    });
    params.executableToolCalls = [
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'add',
          id: 'prepare-sms-draft',
          name: 'prepare sms draft',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.tool:sms_compose'],
        }),
      },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-goals',
        toolMessage: createToolMessage({
          id: 'tc-goals',
          name: 'update_goals',
          content: '{"status":"ok"}',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const goalsUpdatedCalls = params.applyGraphEvents.mock.calls.filter(
      ([events]) => events[0]?.type === 'GOALS_UPDATED',
    );
    expect(goalsUpdatedCalls).toHaveLength(1);
    const goalsUpdatedEvent = goalsUpdatedCalls[0]?.[0][0];
    expect(goalsUpdatedEvent).toEqual(expect.objectContaining({ type: 'GOALS_UPDATED' }));
    if (goalsUpdatedEvent?.type !== 'GOALS_UPDATED') {
      throw new Error('Expected GOALS_UPDATED');
    }
    expect(goalsUpdatedEvent.goals.find((goal) => goal.id === 'prepare-sms-draft')).toEqual(
      expect.objectContaining({
        status: 'completed',
        evidence: [priorEvidence],
      }),
    );
  });

  it('emits canonical graph-applied update_goals results to callbacks and working messages', async () => {
    const params = buildBaseParams();
    const eventOrder: string[] = [];
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        {
          id: 'goal-a',
          title: 'Collect sources',
          status: 'active',
          completionPolicy: 'blocking',
          dependencies: [],
          evidence: ['read_file:source-a.md'],
          successCriteria: ['evidence.min:1'],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    params.applyGraphEvents = jest.fn((events) => {
      if (events.some((event) => event.type === 'GOALS_UPDATED')) {
        eventOrder.push('goals');
      }
      if (events.some((event) => event.type === 'TOOL_RESULT_RECORDED')) {
        eventOrder.push('tool_result');
      }
    });
    params.onToolMessage = jest.fn(async () => {
      eventOrder.push('callback');
    });
    params.executableToolCalls = [
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'complete',
          id: 'goal-a',
          name: 'Collect sources',
        }),
      },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-goals',
        toolMessage: createToolMessage({
          id: 'tc-goals',
          name: 'update_goals',
          arguments: JSON.stringify({
            action: 'complete',
            id: 'goal-a',
            name: 'Collect sources',
          }),
          content: '{"status":"ok","goals":[{"id":"goal-a","status":"active"}]}',
          toolCallOverrides: {
            raw: { thoughtSignature: 'sig-goal-turn' },
          },
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const emittedOutcome = params.onToolMessage.mock.calls[0]?.[0];
    const emittedContent = emittedOutcome?.content;
    expect(typeof emittedContent).toBe('string');
    expect(emittedOutcome).toEqual(
      expect.objectContaining({
        version: 1,
        toolCallId: 'tc-goals',
        status: 'completed',
      }),
    );
    expect(params.workingMessages[0].content).toBe(emittedContent);
    expect(params.workingMessages[0].toolCalls?.[0]?.result).toBe(emittedContent);
    expect(params.workingMessages[0].toolCalls?.[0]?.raw).toEqual({
      thoughtSignature: 'sig-goal-turn',
    });
    expect(eventOrder.slice(0, 3)).toEqual(['goals', 'callback', 'tool_result']);

    const parsed = JSON.parse(emittedContent as string);
    expect(parsed).toEqual(
      expect.objectContaining({
        status: 'ok',
        action: 'complete',
      }),
    );
    expect(parsed.goals).toEqual([
      expect.objectContaining({
        id: 'goal-a',
        status: 'completed',
        completionPolicy: 'blocking',
        evidence: ['read_file:source-a.md'],
        successCriteria: ['evidence.min:1'],
      }),
    ]);
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      {
        type: 'TOOL_RESULT_RECORDED',
        result: {
          id: 'tc-goals',
          name: 'update_goals',
          canonicalized: true,
          graphApplied: true,
        },
      },
    ]);
  });

  it('routes and completes same-batch evidence after an applied goal mutation', async () => {
    const params = buildBaseParams();
    const requestDigest = `sha256:${'4'.repeat(64)}` as const;
    const receipt: ToolEffectReceipt = {
      version: 2,
      receiptId: `ter_${'c'.repeat(32)}`,
      toolCallId: 'tc-memory',
      toolName: 'memory_remember',
      executionRunId: 'execution-run-1',
      contractIdentity: {
        kind: 'code_owned',
        version: 1,
        toolName: 'memory_remember',
        schemaDigest: `sha256:${'6'.repeat(64)}`,
        capabilityContractDigest: `sha256:${'6'.repeat(64)}`,
        workflowContractDigest: `sha256:${'6'.repeat(64)}`,
        effectContractDigest: `sha256:${'6'.repeat(64)}`,
        executionPolicyDigest: `sha256:${'6'.repeat(64)}`,
      },
      transportState: 'returned',
      effectKind: 'memory.write',
      effectState: 'applied',
      verificationState: 'verified',
      requestDigest,
      resultDigest: `sha256:${'5'.repeat(64)}`,
      resource: { kind: 'memory_fact', id: 'fact-avery' },
      recordedAt: 1,
    };
    const effectCriterion = buildEffectCompletionCriterion({
      effectKind: 'memory.write',
      requestDigest,
      resource: { kind: 'memory_fact', id: 'fact-avery' },
      verificationState: 'verified',
    });
    const receiptEvidence = buildToolEffectReceiptEvidence(receipt);
    let graph = { goals: [] as AgentGoal[] };
    params.getGraphSnapshot = jest.fn(() => graph);
    params.applyGraphEvents = jest.fn((events) => {
      graph = applyGoalGraphEvents(graph, events);
    });
    params.groundedRequestScopedTools = [
      tool({
        name: 'memory_remember',
        contract: {
          capabilities: ['write'],
          resourceKinds: ['memory'],
        },
      }),
    ];
    params.executableToolCalls = [
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'add',
          id: 'preferred-contact-memory',
          name: 'preferred-contact-memory',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: [effectCriterion],
        }),
      },
      {
        name: 'memory_remember',
        arguments: '{"fact":{"subject":"user","predicate":"preferred_contact","value":"Avery"}}',
      },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-goals',
        toolMessage: createToolMessage({
          id: 'tc-goals',
          name: 'update_goals',
          content: '{"status":"ok"}',
        }),
      },
      {
        index: 1,
        toolCallId: 'tc-memory',
        toolMessage: createToolMessage({
          id: 'tc-memory',
          name: 'memory_remember',
          content:
            '{"ok":true,"fact":{"subject":"user","predicate":"preferred_contact","value":"Avery"}}',
        }),
        effectReceipt: receipt,
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const memoryGoal = graph.goals.find((goal) => goal.id === 'preferred-contact-memory');
    expect(memoryGoal).toEqual(
      expect.objectContaining({
        status: 'completed',
        evidence: expect.arrayContaining([receiptEvidence]),
      }),
    );
    expect(params.workingMessages).toHaveLength(2);
    expect(params.workingMessages[1].isError).not.toBe(true);
    expect(extractGoalEvidenceEvents(params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: 'preferred-contact-memory',
          evidence: receiptEvidence,
        }),
      ]),
    );
    expect(params.publishWorkflowToolResultProgress).toHaveBeenCalledTimes(2);
    expect(params.recordPostToolFinalTextDirective).toHaveBeenCalledWith(
      expect.objectContaining({
        hasActivePersistentGoal: false,
        hasIncompleteBlockingGoal: false,
      }),
    );
  });

  it('does not treat a completed code-owned effect guard as whole-workflow completion', async () => {
    const params = buildBaseParams();
    const requestDigest = `sha256:${'7'.repeat(64)}` as const;
    const receipt: ToolEffectReceipt = {
      version: 2,
      receiptId: `ter_${'7'.repeat(32)}`,
      toolCallId: 'tc-calendar-create',
      toolName: 'calendar_create_event',
      executionRunId: 'execution-run-1',
      contractIdentity: {
        kind: 'code_owned',
        version: 1,
        toolName: 'calendar_create_event',
        schemaDigest: `sha256:${'7'.repeat(64)}`,
        capabilityContractDigest: `sha256:${'7'.repeat(64)}`,
        workflowContractDigest: `sha256:${'7'.repeat(64)}`,
        effectContractDigest: `sha256:${'7'.repeat(64)}`,
        executionPolicyDigest: `sha256:${'7'.repeat(64)}`,
      },
      transportState: 'returned',
      effectKind: 'calendar.create',
      effectState: 'applied',
      verificationState: 'verified',
      requestDigest,
      resultDigest: `sha256:${'8'.repeat(64)}`,
      resource: { kind: 'calendar_event', id: 'event-1' },
      recordedAt: 1,
    };
    const criterion = buildEffectCompletionCriterion({
      effectKind: 'calendar.create',
      requestDigest,
      resource: { kind: 'calendar_event', id: '*' },
      verificationState: 'verified',
    });
    let graph = {
      goals: [
        createGoal({
          id: 'effect-calendar-create',
          title: 'Verify calendar_create_event effect',
          status: 'active',
          owner: CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
          completionPolicy: 'blocking',
          successCriteria: [criterion],
        }),
      ],
    };
    params.getGraphSnapshot = jest.fn(() => graph);
    params.applyGraphEvents = jest.fn((events) => {
      graph = applyGoalGraphEvents(graph, events);
    });
    params.groundedRequestScopedTools = [
      tool({
        name: 'calendar_create_event',
        contract: {
          capabilities: ['write'],
          resourceKinds: ['device'],
        },
      }),
    ];
    params.executableToolCalls = [
      {
        name: 'calendar_create_event',
        arguments: '{"title":"Review"}',
      },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-calendar-create',
        toolMessage: createToolMessage({
          id: 'tc-calendar-create',
          name: 'calendar_create_event',
          content: '{"status":"created_verified","eventId":"event-1"}',
        }),
        effectReceipt: receipt,
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(graph.goals[0]?.status).toBe('completed');
    expect(params.recordPostToolFinalTextDirective).toHaveBeenCalledWith(
      expect.objectContaining({
        hasCompletedBlockingGoal: false,
        hasIncompleteBlockingGoal: false,
      }),
    );
  });

  it('retires a code-owned effect guard after a definitive failed receipt', async () => {
    const params = buildBaseParams();
    const requestDigest = `sha256:${'9'.repeat(64)}` as const;
    const receipt: ToolEffectReceipt = {
      version: 2,
      receiptId: `ter_${'9'.repeat(32)}`,
      toolCallId: 'tc-memory-failed',
      toolName: 'memory_remember',
      executionRunId: 'execution-run-1',
      contractIdentity: {
        kind: 'code_owned',
        version: 1,
        toolName: 'memory_remember',
        schemaDigest: `sha256:${'9'.repeat(64)}`,
        capabilityContractDigest: `sha256:${'9'.repeat(64)}`,
        workflowContractDigest: `sha256:${'9'.repeat(64)}`,
        effectContractDigest: `sha256:${'9'.repeat(64)}`,
        executionPolicyDigest: `sha256:${'9'.repeat(64)}`,
      },
      transportState: 'returned',
      effectKind: 'memory.write',
      effectState: 'failed',
      verificationState: 'unverified',
      requestDigest,
      resultDigest: `sha256:${'a'.repeat(64)}`,
      recordedAt: 1,
    };
    const criterion = buildEffectCompletionCriterion({
      effectKind: 'memory.write',
      requestDigest,
      resource: { kind: 'memory_fact', id: '*' },
      verificationState: 'verified',
    });
    let graph = {
      goals: [
        createGoal({
          id: 'effect-memory-write',
          title: 'Verify memory_remember effect',
          status: 'active',
          owner: CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
          completionPolicy: 'blocking',
          successCriteria: [criterion],
        }),
      ],
    };
    params.getGraphSnapshot = jest.fn(() => graph);
    params.applyGraphEvents = jest.fn((events) => {
      graph = applyGoalGraphEvents(graph, events);
    });
    params.groundedRequestScopedTools = [
      tool({
        name: 'memory_remember',
        contract: {
          capabilities: ['write'],
          resourceKinds: ['memory'],
        },
      }),
    ];
    params.executableToolCalls = [
      {
        name: 'memory_remember',
        arguments: '{"semanticEvidence":{}}',
      },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-memory-failed',
        toolMessage: createToolMessage({
          id: 'tc-memory-failed',
          name: 'memory_remember',
          content: '{"status":"rejected","code":"grounding_required"}',
          isError: true,
        }),
        effectReceipt: receipt,
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(graph.goals).toEqual([]);
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'GOALS_UPDATED',
        reason: 'effect_completion_contract:terminal_failed_retired',
        projectToMemoryTasks: false,
      }),
    ]);
    expect(params.recordPostToolFinalTextDirective).toHaveBeenCalledWith(
      expect.objectContaining({
        hasCompletedBlockingGoal: false,
        hasIncompleteBlockingGoal: false,
      }),
    );
  });

  it('keeps newer persistent focus active for stale mixed-batch activation', async () => {
    const params = buildBaseParams();
    let graph = {
      goals: [
        createGoal({
          id: 'scope-a',
          title: 'scope-a',
          status: 'pending',
          completionPolicy: 'persistent',
          createdAt: 1,
          updatedAt: 1,
        }),
        createGoal({
          id: 'scope-b',
          title: 'scope-b',
          status: 'active',
          completionPolicy: 'persistent',
          createdAt: 2,
          updatedAt: 2,
        }),
      ],
    };
    params.getGraphSnapshot = jest.fn(() => graph);
    params.applyGraphEvents = jest.fn((events) => {
      graph = applyGoalGraphEvents(graph, events);
    });
    params.executableToolCalls = [
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'activate',
          id: 'scope-a',
          name: 'Scope A',
        }),
      },
      {
        name: 'memory_remember',
        arguments: '{"fact":"stale"}',
      },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-goals',
        toolMessage: createToolMessage({
          id: 'tc-goals',
          name: 'update_goals',
          content: '{"status":"ok"}',
        }),
      },
      {
        index: 1,
        toolCallId: 'tc-memory',
        toolMessage: createToolMessage({
          id: 'tc-memory',
          name: 'memory_remember',
          content: 'Error: stale batch should not drive graph progress',
          isError: true,
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(graph.goals.find((goal) => goal.id === 'scope-a')?.status).toBe('pending');
    expect(graph.goals.find((goal) => goal.id === 'scope-b')?.status).toBe('active');
    expect(params.workingMessages[1].isError).toBe(true);
    expect(params.workingMessages[1].content).toBe(
      'Error: stale batch should not drive graph progress',
    );
  });

  it('serializes repeated goal mutations against the latest graph snapshot', async () => {
    const params = buildBaseParams();
    let graph = { goals: [] as AgentGoal[] };
    params.getGraphSnapshot = jest.fn(() => graph);
    params.applyGraphEvents = jest.fn((events) => {
      graph = applyGoalGraphEvents(graph, events);
    });
    params.executableToolCalls = [
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'add',
          id: 'first-goal',
          name: 'first-goal',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.json_field:status:done'],
        }),
      },
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'add',
          id: 'second-goal',
          name: 'second-goal',
          status: 'pending',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.json_field:status:done'],
        }),
      },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-goals-1',
        toolMessage: createToolMessage({
          id: 'tc-goals-1',
          name: 'update_goals',
          content: '{"status":"ok"}',
        }),
      },
      {
        index: 1,
        toolCallId: 'tc-goals-2',
        toolMessage: createToolMessage({
          id: 'tc-goals-2',
          name: 'update_goals',
          content: '{"status":"ok"}',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(graph.goals.map((goal) => goal.id)).toEqual(['first-goal', 'second-goal']);
    expect(graph.goals.map((goal) => [goal.id, goal.status])).toEqual([
      ['first-goal', 'active'],
      ['second-goal', 'pending'],
    ]);
    expect(JSON.parse(params.workingMessages[0].content)).toEqual(
      expect.objectContaining({
        status: 'ok',
        action: 'add',
        goals: [expect.objectContaining({ id: 'first-goal' })],
      }),
    );
    expect(JSON.parse(params.workingMessages[1].content)).toEqual(
      expect.objectContaining({
        status: 'ok',
        action: 'add',
        goals: [
          expect.objectContaining({ id: 'first-goal' }),
          expect.objectContaining({ id: 'second-goal' }),
        ],
      }),
    );
    const goalsUpdatedCalls = params.applyGraphEvents.mock.calls.filter(([events]) =>
      events.some((event) => event.type === 'GOALS_UPDATED'),
    );
    expect(goalsUpdatedCalls).toHaveLength(2);
  });

  it('finalizes yielded tool turns through the graph terminal event', async () => {
    const params = buildBaseParams();
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc3',
        toolMessage: createToolMessage({
          id: 'tc3',
          name: 'sessions_wait',
          content: '{"status":"checkpointed"}',
        }),
        yieldedMessage: 'Checkpoint now',
      },
    ];

    const result = await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'finalized',
      }),
    );
    expect(params.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'YIELDED',
          reason: 'tool_yielded',
        },
        content: 'Checkpoint now',
        sessionEndReason: 'yielded',
      }),
    );
    expect(params.onStateChange).not.toHaveBeenCalledWith('thinking');
  });
});
