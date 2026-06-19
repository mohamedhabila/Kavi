import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';
import type { Message } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';
import type { AgentControlGraphEvent } from '../../src/engine/graph/agentControlGraph';
import type { ToolCallRecord } from '../../src/engine/loopDetection';
import {
  resolveAgentControlGraphToolExecutionOutcomes,
  type ToolExecutionOutcome,
} from '../../src/engine/graph/toolExecutionOutcomeResolution';
import { areGoalSuccessCriteriaSatisfied } from '../../src/engine/goals/completionEvidence';
import { addGoalEvidence } from '../../src/engine/goals/graphState';
import type { AgentGoal } from '../../src/engine/goals/types';

const tools: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a file from the workspace',
    inputSchema: { type: 'object', properties: {} },
  },
];

function tool(params: Pick<ToolDefinition, 'name' | 'contract'>): ToolDefinition {
  return {
    name: params.name,
    description: params.name,
    input_schema: { type: 'object', properties: {} },
    ...(params.contract ? { contract: params.contract } : {}),
  };
}

function createGoal(overrides: Partial<AgentGoal> & Pick<AgentGoal, 'id'>): AgentGoal {
  return {
    title: overrides.id,
    status: 'active',
    dependencies: [],
    evidence: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function extractGoalEvidenceEvents(params: ReturnType<typeof buildBaseParams>) {
  return params.applyGraphEvents.mock.calls
    .flatMap(([events]) => events)
    .filter((event) => event.type === 'GOAL_EVIDENCE_ADDED');
}

function applyGoalGraphEvents(
  graph: { goals: AgentGoal[] },
  events: ReadonlyArray<AgentControlGraphEvent>,
): { goals: AgentGoal[] } {
  let next = graph;
  for (const event of events) {
    if (event.type === 'GOALS_UPDATED') {
      next = { goals: event.goals };
      continue;
    }
    if (event.type === 'GOAL_EVIDENCE_ADDED') {
      next = {
        goals: addGoalEvidence(next.goals, event.goalId, event.evidence, event.timestamp),
      };
    }
  }
  return next;
}

function createToolMessage(params: {
  id: string;
  name: string;
  arguments?: string;
  content: string;
  isError?: boolean;
  toolCallOverrides?: Partial<NonNullable<Message['toolCalls']>[number]>;
}): Message {
  return {
    id: `msg_${params.id}`,
    role: 'tool',
    content: params.content,
    toolCallId: params.id,
    toolCalls: [
      {
        id: params.id,
        name: params.name,
        arguments: params.arguments ?? '{}',
        status: params.isError ? 'failed' : 'completed',
        ...(params.isError ? { error: params.content } : {}),
        ...params.toolCallOverrides,
      },
    ],
    timestamp: 1000,
    ...(params.isError ? { isError: true } : {}),
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
  const workingMessages: Message[] = [];
  return {
    iteration: 2,
    executableToolCalls: [{ name: 'read_file' }],
    toolExecutionOutcomes: [] as ToolExecutionOutcome[],
    groundedRequestScopedTools: tools,
    activation: undefined,
    completedWorkflowToolNames: new Set<string>(),
    trackedAsyncOperations: new Map<string, TrackedAsyncOperation>(),
    toolCallHistory: [] as ToolCallRecord[],
    pendingAsyncMonitorToolNames: new Set<string>(['sessions_wait']),
    lastPendingAsyncSignature: '',
    contextWindow: 20000,
    conversationId: 'conv-test',
    compactionEngine: null,
    livingMemory: null,
    onCompaction: undefined,
    warn: jest.fn(),
    onToolMessage: jest.fn().mockResolvedValue(undefined),
    onStateChange: jest.fn(),
    yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
    applyGraphEvents: jest.fn(),
    publishWorkflowToolResultProgress: jest.fn(({ toolMessage }) => ({
      observedToolName: toolMessage.toolCalls?.[0]?.name,
      newlyCompletedToolNames: ['read_file'],
      nextCompletedToolNames: ['read_file'],
    })),
    syncPendingAsyncOperationsToGraph: jest.fn(),
    recordTurnDirectives: jest.fn(),
    recordPostToolFinalTextDirective: jest.fn(() => false),
    getModelTurnBlocker: jest.fn(() => undefined),
    finishWithGraphTerminalEvent: jest.fn().mockResolvedValue(undefined),
    getGraphSnapshot: jest.fn().mockReturnValue({ goals: [] }),
    workingMessages,
  };
}

describe('tool execution outcome resolution', () => {
  it('records tool results and continues thinking', async () => {
    const params = buildBaseParams();
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc1',
        toolMessage: createToolMessage({
          id: 'tc1',
          name: 'read_file',
          content: 'file body',
        }),
      },
    ];

    const result = await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(result.status).toBe('continued');
    expect(params.onToolMessage).toHaveBeenCalledWith('tc1', 'file body');
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'TOOL_RESULT_RECORDED',
        result: expect.objectContaining({
          id: 'tc1',
          name: 'read_file',
        }),
      }),
    ]);
    expect(params.publishWorkflowToolResultProgress).toHaveBeenCalled();
    expect(params.recordPostToolFinalTextDirective).toHaveBeenCalledWith({
      pendingAsyncCount: 0,
      hasAsyncTerminalResolution: false,
      hasActivePersistentGoal: false,
      hasCompletedBlockingGoal: false,
      hasIncompleteBlockingGoal: false,
    });
    expect(params.onStateChange).toHaveBeenCalledWith('thinking');
    expect(params.finishWithGraphTerminalEvent).not.toHaveBeenCalled();
  });

  it('activates discovered tools using the executable call name when tool messages are minimal', async () => {
    const params = buildBaseParams();
    params.executableToolCalls = [{ name: 'tool_catalog', arguments: '{"category":"calendar"}' }];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-catalog',
        toolMessage: {
          id: 'msg_tc-catalog',
          role: 'tool',
          content: JSON.stringify({
            mode: 'category',
            category: 'calendar',
            tools: [
              {
                name: 'calendar_create_event',
                activation: {
                  name: 'calendar_create_event',
                  eligible: true,
                  callableNow: false,
                  reason: 'discoverable',
                },
              },
            ],
          }),
          toolCallId: 'tc-catalog',
          timestamp: 1000,
        },
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const appliedEvents = params.applyGraphEvents.mock.calls.flatMap(([events]) => events);
    expect(appliedEvents).toEqual(
      expect.arrayContaining([
        {
          type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
          toolNames: ['calendar_create_event'],
          reason: 'tool_catalog:discovery',
          timestamp: expect.any(Number),
        },
      ]),
    );
  });

  it('appends async join guidance when pending async state changes', async () => {
    const params = buildBaseParams();
    const pendingOperation = createPendingOperation();
    params.trackedAsyncOperations = new Map([[pendingOperation.key, pendingOperation]]);
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc2',
        toolMessage: createToolMessage({
          id: 'tc2',
          name: 'sessions_status',
          content: '{"status":"running","pendingCount":1}',
        }),
      },
    ];

    const result = await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(result.status).toBe('continued');
    expect(params.syncPendingAsyncOperationsToGraph).toHaveBeenCalled();
    expect(
      result.workingMessages.some((message) =>
        message.content.includes('[SYSTEM WORKFLOW JOIN REQUIRED]'),
      ),
    ).toBe(true);
  });

  it('does not treat a non-blocking background worker launch as pending foreground async work', async () => {
    const params = buildBaseParams();
    const pendingOperation = createPendingOperation({ blocksFinalization: false });
    params.executableToolCalls = [{ name: 'sessions_spawn' }];
    params.trackedAsyncOperations = new Map([[pendingOperation.key, pendingOperation]]);
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-bg',
        toolMessage: createToolMessage({
          id: 'tc-bg',
          name: 'sessions_spawn',
          arguments: '{"prompt":"Research this","waitForCompletion":false}',
          content: '{"status":"running","sessionId":"sub-1"}',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(params.recordPostToolFinalTextDirective).toHaveBeenCalledWith({
      pendingAsyncCount: 0,
      hasAsyncTerminalResolution: false,
      hasActivePersistentGoal: false,
      hasCompletedBlockingGoal: false,
      hasIncompleteBlockingGoal: false,
    });
  });

  it('reports settled active persistent context to the post-tool final-text directive', async () => {
    const params = buildBaseParams();
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        {
          id: 'focus-context',
          title: 'Track active conversation focus',
          status: 'active',
          completionPolicy: 'persistent',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-persistent',
        toolMessage: createToolMessage({
          id: 'tc-persistent',
          name: 'read_file',
          content: 'focused context evidence',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(params.recordPostToolFinalTextDirective).toHaveBeenCalledWith({
      pendingAsyncCount: 0,
      hasAsyncTerminalResolution: false,
      hasActivePersistentGoal: true,
      hasCompletedBlockingGoal: false,
      hasIncompleteBlockingGoal: false,
    });
  });

  it('reports completed blocking goals to the post-tool final-text directive', async () => {
    const params = buildBaseParams();
    let graph = {
      goals: [
        createGoal({
          id: 'finite-task',
          title: 'Finish finite task',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.json_field:status:ok'],
        }),
      ],
    };
    params.getGraphSnapshot = jest.fn(() => graph);
    params.applyGraphEvents = jest.fn((events) => {
      graph = applyGoalGraphEvents(graph, events);
    });
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-blocking',
        toolMessage: createToolMessage({
          id: 'tc-blocking',
          name: 'read_file',
          content: '{"status":"ok"}',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(params.recordPostToolFinalTextDirective).toHaveBeenCalledWith({
      pendingAsyncCount: 0,
      hasAsyncTerminalResolution: false,
      hasActivePersistentGoal: false,
      hasCompletedBlockingGoal: true,
      hasIncompleteBlockingGoal: false,
    });
  });

  it('does not report previously completed blocking goals as current tool-batch completions', async () => {
    const params = buildBaseParams();
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        createGoal({
          id: 'settled-memory',
          title: 'Settled memory task',
          status: 'completed',
          completionPolicy: 'blocking',
          evidence: ['memory_remember:{"status":"remembered"}'],
          successCriteria: ['evidence.min:1'],
          completedAt: 2,
        }),
      ],
    });
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-recall',
        toolMessage: createToolMessage({
          id: 'tc-recall',
          name: 'memory_recall',
          content: '{"status":"ok","facts":[]}',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(params.recordPostToolFinalTextDirective).toHaveBeenCalledWith({
      pendingAsyncCount: 0,
      hasAsyncTerminalResolution: false,
      hasActivePersistentGoal: false,
      hasCompletedBlockingGoal: false,
      hasIncompleteBlockingGoal: false,
    });
  });

  it('auto-links structural evidence to active goals', async () => {
    const params = buildBaseParams();
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        {
          id: 'goal-1',
          title: 'Analyze data',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-python',
        toolMessage: createToolMessage({
          id: 'tc-python',
          name: 'python',
          content: JSON.stringify({
            status: 'completed',
            files: [{ path: 'reports/analysis.json' }],
          }),
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      {
        type: 'GOAL_EVIDENCE_ADDED',
        goalId: 'goal-1',
        evidence: 'python:execution:success',
        timestamp: expect.any(Number),
      },
    ]);
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      {
        type: 'GOAL_EVIDENCE_ADDED',
        goalId: 'goal-1',
        evidence: 'python:artifact:reports/analysis.json',
        timestamp: expect.any(Number),
      },
    ]);
  });

  it('routes memory evidence to memory goals without satisfying device goals', async () => {
    const params = buildBaseParams();
    params.groundedRequestScopedTools = [
      tool({
        name: 'memory_remember',
        contract: {
          capabilities: ['write'],
          resourceKinds: ['memory'],
        },
      }),
    ];
    params.executableToolCalls = [{ name: 'memory_remember' }];
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        createGoal({
          id: 'memory-state',
          requiredCapabilities: ['write'],
          requiredResourceKinds: ['memory'],
          successCriteria: ['evidence.json_field:status:remembered'],
        }),
        createGoal({
          id: 'mobile-action',
          requiredCapabilities: ['write', 'verify'],
          requiredResourceKinds: ['device'],
          evidence: ['sms_compose:{"status":"sms_composer_opened"}'],
          successCriteria: ['evidence.json_field:status:sms_composer_opened'],
        }),
      ],
    });
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-memory',
        toolMessage: createToolMessage({
          id: 'tc-memory',
          name: 'memory_remember',
          content: '{"status":"remembered","factId":"fact-1"}',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const evidenceEvents = extractGoalEvidenceEvents(params);
    expect(evidenceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: 'memory-state',
          evidence: 'memory_remember:{"status":"remembered","factId":"fact-1"}',
        }),
      ]),
    );
    expect(new Set(evidenceEvents.map((event) => event.goalId))).toEqual(new Set(['memory-state']));
  });

  it('routes contact lookup evidence without completing SMS criteria prematurely', async () => {
    const params = buildBaseParams();
    const mobileGoal = createGoal({
      id: 'mobile-contact-message',
      requiredCapabilities: ['read', 'write', 'verify'],
      requiredResourceKinds: ['device'],
      successCriteria: [
        'evidence.json_field:0.id:e2e-contact-avery',
        'evidence.json_field:status:sms_composer_opened',
        'evidence.json_field:recipientCount:1',
      ],
    });
    params.groundedRequestScopedTools = [
      tool({
        name: 'contacts_search',
        contract: {
          capabilities: ['discover', 'read'],
          resourceKinds: ['device'],
        },
      }),
    ];
    params.executableToolCalls = [{ name: 'contacts_search' }];
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [mobileGoal],
    });
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-contacts',
        toolMessage: createToolMessage({
          id: 'tc-contacts',
          name: 'contacts_search',
          content: '[{"id":"e2e-contact-avery","phoneNumbers":[{"number":"+15550101001"}]}]',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const evidenceEvents = extractGoalEvidenceEvents(params);
    expect(evidenceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: 'mobile-contact-message',
          evidence:
            'contacts_search:[{"id":"e2e-contact-avery","phoneNumbers":[{"number":"+15550101001"}]}]',
        }),
        expect.objectContaining({
          goalId: 'mobile-contact-message',
          evidence: 'contacts_search:{"length":1}',
        }),
      ]),
    );
    expect(
      areGoalSuccessCriteriaSatisfied({
        ...mobileGoal,
        evidence: evidenceEvents.map((event) => event.evidence),
      }),
    ).toBe(false);
  });

  it('routes matching tool evidence to blocked goals before reactivation', async () => {
    const params = buildBaseParams();
    params.groundedRequestScopedTools = [
      tool({
        name: 'contacts_search',
        contract: {
          capabilities: ['discover', 'read'],
          resourceKinds: ['device'],
        },
      }),
    ];
    params.executableToolCalls = [{ name: 'contacts_search' }];
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        createGoal({
          id: 'blocked-contact-message',
          status: 'blocked',
          requiredCapabilities: ['read', 'write', 'verify'],
          requiredResourceKinds: ['device'],
          completionPolicy: 'blocking',
          successCriteria: ['evidence.json_field:0.id:e2e-contact-avery'],
        }),
      ],
    });
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-contacts',
        toolMessage: createToolMessage({
          id: 'tc-contacts',
          name: 'contacts_search',
          content: '[{"id":"e2e-contact-avery","phoneNumbers":[{"number":"+15550101001"}]}]',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(extractGoalEvidenceEvents(params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: 'blocked-contact-message',
          evidence:
            'contacts_search:[{"id":"e2e-contact-avery","phoneNumbers":[{"number":"+15550101001"}]}]',
        }),
      ]),
    );
  });

  it('routes workspace write evidence only to conversation workspace goals', async () => {
    const params = buildBaseParams();
    params.groundedRequestScopedTools = [
      tool({
        name: 'write_file',
        contract: {
          capabilities: ['write', 'verify'],
          resourceKinds: ['conversation_workspace'],
        },
      }),
    ];
    params.executableToolCalls = [{ name: 'write_file' }];
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        createGoal({
          id: 'workspace-artifact',
          requiredCapabilities: ['write'],
          requiredResourceKinds: ['conversation_workspace'],
        }),
        createGoal({
          id: 'memory-state',
          requiredCapabilities: ['write'],
          requiredResourceKinds: ['memory'],
        }),
        createGoal({
          id: 'mobile-action',
          requiredCapabilities: ['write'],
          requiredResourceKinds: ['device'],
        }),
      ],
    });
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-write',
        toolMessage: createToolMessage({
          id: 'tc-write',
          name: 'write_file',
          content: '{"status":"ok","path":"artifacts/out.txt"}',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const evidenceEvents = extractGoalEvidenceEvents(params);
    expect(evidenceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: 'workspace-artifact',
          evidence: 'write_file:{"status":"ok","path":"artifacts/out.txt"}',
        }),
      ]),
    );
    expect(new Set(evidenceEvents.map((event) => event.goalId))).toEqual(
      new Set(['workspace-artifact']),
    );
  });

  it('rejects invalid goal graphs after update_goals mutations', async () => {
    const params = buildBaseParams();
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        {
          id: 'goal-a',
          title: 'Collect sources',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    params.executableToolCalls = [
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'add',
          id: 'goal-b',
          name: 'Write report',
          completionPolicy: 'persistent',
          dependencies: ['missing-goal'],
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
            action: 'add',
            id: 'goal-b',
            name: 'Write report',
            completionPolicy: 'persistent',
            dependencies: ['missing-goal'],
          }),
          content: '{"status":"ok"}',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const goalsUpdatedCalls = params.applyGraphEvents.mock.calls.filter(
      ([events]) => events[0]?.type === 'GOALS_UPDATED',
    );
    expect(goalsUpdatedCalls).toHaveLength(0);
    expect(params.workingMessages[0].content).toContain('missing-goal');
    expect(params.workingMessages[0].content).toContain('error');
  });

  it('rejects update_goals block mutations for unfinished blocking goals', async () => {
    const params = buildBaseParams();
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        createGoal({
          id: 'calendar-mutation',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: [
            'evidence.json_field:status:created',
            'evidence.json_field:status:updated',
          ],
          evidence: ['calendar_create_event:{"status":"created","eventId":"e2e-event-1"}'],
        }),
      ],
    });
    params.executableToolCalls = [
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'block',
          id: 'calendar-mutation',
          blockedReason: 'gate:calendar-mutation:evidence.json_field:status:updated',
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
    expect(goalsUpdatedCalls).toHaveLength(0);
    const parsed = JSON.parse(params.workingMessages[0].content);
    expect(parsed).toEqual(
      expect.objectContaining({
        status: 'error',
        action: 'block',
      }),
    );
    expect(parsed.structuredErrors).toContainEqual(
      expect.objectContaining({ code: 'evidence_required' }),
    );
  });

  it('rejects provider-qualified update_goals success criteria at runtime', async () => {
    const params = buildBaseParams();
    params.getGraphSnapshot = jest.fn().mockReturnValue({ goals: [] });
    params.executableToolCalls = [
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'add',
          id: 'scope-a',
          name: 'scope-a-planning',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.tool:default_api:update_goals'],
        }),
      },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-goals',
        toolMessage: createToolMessage({
          id: 'tc-goals',
          name: 'default_api:update_goals',
          content: '{"status":"ok"}',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const goalsUpdatedCalls = params.applyGraphEvents.mock.calls.filter(
      ([events]) => events[0]?.type === 'GOALS_UPDATED',
    );
    expect(goalsUpdatedCalls).toHaveLength(0);

    const parsed = JSON.parse(params.workingMessages[0].content);
    expect(parsed.status).toBe('error');
    expect(parsed.structuredErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_success_criteria' }),
      ]),
    );
  });

  it('rejects tool discovery success criteria at runtime', async () => {
    const params = buildBaseParams();
    params.getGraphSnapshot = jest.fn().mockReturnValue({ goals: [] });
    params.executableToolCalls = [
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'add',
          id: 'discover-tools',
          name: 'discover tools',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.tool:tool_catalog'],
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
    expect(goalsUpdatedCalls).toHaveLength(0);

    const parsed = JSON.parse(params.workingMessages[0].content);
    expect(parsed.status).toBe('error');
    expect(parsed.structuredErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_success_criteria' }),
      ]),
    );
  });

  it('normalizes active focus adds with non-structural criteria instead of stalling', async () => {
    const params = buildBaseParams();
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        createGoal({
          id: 'scope-a',
          title: 'scope-a-planning',
          status: 'active',
          completionPolicy: 'persistent',
        }),
      ],
    });
    params.executableToolCalls = [
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'add',
          id: 'scope-b',
          name: 'scope-b-planning',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: ['scope-b-planning'],
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
    expect(goalsUpdatedEvent.goals.find((goal) => goal.id === 'scope-a')?.status).toBe(
      'pending',
    );
    expect(goalsUpdatedEvent.goals.find((goal) => goal.id === 'scope-b')).toEqual(
      expect.objectContaining({
        status: 'active',
        completionPolicy: 'persistent',
      }),
    );

    const parsed = JSON.parse(params.workingMessages[0].content);
    expect(parsed.status).toBe('ok');
    expect(parsed.goals.find((goal: { id: string }) => goal.id === 'scope-b')).toEqual(
      expect.objectContaining({
        status: 'active',
        completionPolicy: 'persistent',
      }),
    );
  });

  it('records evidence for persistent focus completion attempts without blocking recovery', async () => {
    const params = buildBaseParams();
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        createGoal({
          id: 'scope-a',
          title: 'scope-a-planning',
          status: 'active',
          completionPolicy: 'persistent',
        }),
      ],
    });
    params.executableToolCalls = [
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'complete',
          id: 'scope-a',
          name: 'scope-a-planning',
          evidence: ['user_turn:SCOPE-A-E2E-42'],
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

    const goalsUpdatedEvent = params.applyGraphEvents.mock.calls
      .flatMap(([events]) => events)
      .find((event) => event.type === 'GOALS_UPDATED');
    expect(goalsUpdatedEvent).toEqual(expect.objectContaining({ type: 'GOALS_UPDATED' }));
    if (goalsUpdatedEvent?.type !== 'GOALS_UPDATED') {
      throw new Error('Expected GOALS_UPDATED');
    }
    expect(goalsUpdatedEvent.goals[0]).toEqual(
      expect.objectContaining({
        id: 'scope-a',
        status: 'active',
        evidence: ['user_turn:SCOPE-A-E2E-42'],
      }),
    );

    const parsed = JSON.parse(params.workingMessages[0].content);
    expect(parsed.status).toBe('ok');
    expect(parsed.action).toBe('update');
  });

  it('returns structural repair shape for missing goal titles', async () => {
    const params = buildBaseParams();
    params.getGraphSnapshot = jest.fn().mockReturnValue({ goals: [] });
    params.executableToolCalls = [
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'add',
          id: 'scope-b',
          status: 'active',
          completionPolicy: 'persistent',
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
    expect(goalsUpdatedCalls).toHaveLength(0);

    const parsed = JSON.parse(params.workingMessages[0].content);
    expect(parsed.status).toBe('error');
    expect(parsed.structuredErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing_title', goalId: 'scope-b' }),
      ]),
    );
    expect(parsed.repair).toEqual(
      expect.objectContaining({
        retryable: true,
        code: 'missing_title',
        fieldPlacement: expect.stringContaining('root'),
        missingFields: expect.arrayContaining(['name']),
        missingFieldLocations: [{ goalId: 'scope-b', field: 'name', path: 'name' }],
        retryArguments: { id: 'scope-b', name: '<visible-goal-name>' },
      }),
    );
    expect(parsed.repair.expectedShape).toEqual(
      expect.objectContaining({
        id: '<stable-goal-id>',
        name: '<visible-goal-name>',
      }),
    );
  });

  it('updates tool call history with canonical graph mutation errors', async () => {
    const params = buildBaseParams();
    params.getGraphSnapshot = jest.fn().mockReturnValue({ goals: [] });
    params.executableToolCalls = [
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'complete',
          id: 'missing-goal',
        }),
      },
    ];
    params.toolCallHistory.push({
      id: 'tc-goals',
      name: 'update_goals',
      arguments: params.executableToolCalls[0].arguments,
      timestamp: 1,
      result: '{"status":"ok","action":"complete"}',
    });
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-goals',
        toolMessage: createToolMessage({
          id: 'tc-goals',
          name: 'update_goals',
          content: '{"status":"ok","action":"complete"}',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const historyResult = params.toolCallHistory[0]?.result;
    expect(historyResult).toBeDefined();
    const parsed = JSON.parse(historyResult!);
    expect(parsed.status).toBe('error');
    expect(parsed.structuredErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'goal_not_found', goalId: 'missing-goal' }),
      ]),
    );
    expect(parsed.repair).toEqual(
      expect.objectContaining({ retryable: true, code: 'goal_not_found' }),
    );
  });

  it('rejects unregistered tool evidence success criteria at runtime', async () => {
    const params = buildBaseParams();
    params.getGraphSnapshot = jest.fn().mockReturnValue({ goals: [] });
    params.executableToolCalls = [
      {
        name: 'update_goals',
        arguments: JSON.stringify({
          action: 'add',
          id: 'stale-memory-update',
          name: 'stale memory update',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: [
            'evidence.tool:memory_set',
            'evidence.tool:default_api:memory_delete',
          ],
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
    expect(goalsUpdatedCalls).toHaveLength(0);

    const parsed = JSON.parse(params.workingMessages[0].content);
    expect(parsed.status).toBe('error');
    expect(parsed.structuredErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_success_criteria' }),
      ]),
    );
    expect(params.workingMessages[0].content).toContain('registered tools');
  });

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
          }),
          content: '{"status":"ok","goals":[{"id":"goal-a","status":"active"}]}',
          toolCallOverrides: {
            raw: { thoughtSignature: 'sig-goal-turn' },
          },
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const emittedContent = params.onToolMessage.mock.calls[0]?.[1];
    expect(typeof emittedContent).toBe('string');
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
          successCriteria: ['evidence.json_field:fact.value:Avery'],
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
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const memoryGoal = graph.goals.find((goal) => goal.id === 'preferred-contact-memory');
    expect(memoryGoal).toEqual(
      expect.objectContaining({
        status: 'completed',
        evidence: expect.arrayContaining([
          'memory_remember:{"ok":true,"fact":{"subject":"user","predicate":"preferred_contact","value":"Avery"}}',
        ]),
      }),
    );
    expect(params.workingMessages).toHaveLength(2);
    expect(params.workingMessages[1].isError).not.toBe(true);
    expect(extractGoalEvidenceEvents(params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: 'preferred-contact-memory',
          evidence:
            'memory_remember:{"ok":true,"fact":{"subject":"user","predicate":"preferred_contact","value":"Avery"}}',
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
    expect(params.workingMessages[1].content).toBe('Error: stale batch should not drive graph progress');
  });

  it('defers repeated goal mutations after one graph mutation in a batch', async () => {
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
          status: 'active',
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

    expect(graph.goals.map((goal) => goal.id)).toEqual(['first-goal']);
    expect(JSON.parse(params.workingMessages[1].content)).toEqual({
      status: 'deferred',
      reason: 'graph_mutation_boundary',
      tool: 'update_goals',
    });
    const goalsUpdatedCalls = params.applyGraphEvents.mock.calls.filter(
      ([events]) => events.some((event) => event.type === 'GOALS_UPDATED'),
    );
    expect(goalsUpdatedCalls).toHaveLength(1);
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
