import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import {
  applyGoalGraphEvents,
  buildBaseParams,
  createGoal,
  createPendingOperation,
  createToolMessage,
} from '../helpers/toolExecutionOutcomeHarness';
import {
  createInitialAgentControlGraphSnapshot,
  reduceAgentControlGraph,
} from '../../src/engine/graph/agentControlGraph';
import { createPersistedMobileControllerHandoffFixture } from '../helpers/mobileControllerHandoffFixture';

describe('tool execution outcome resolution', () => {
  it('projects a deferred mobile action into waiting state without a tool result', async () => {
    const deferredHandoff = createPersistedMobileControllerHandoffFixture();
    const params = buildBaseParams();
    params.executableToolCalls = [
      {
        name: 'mobile_ui_action',
        arguments: JSON.stringify(deferredHandoff.handoff.action),
      },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: deferredHandoff.handoffRef.toolCallId,
        deferredHandoff,
        effectDispatchObservation: {
          kind: 'deferred',
          handoff: deferredHandoff.handoffRef,
        },
      },
    ];
    let graph = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'MODEL_TURN_STARTED', iteration: 2, timestamp: 100 },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 2,
        toolCalls: [
          { id: deferredHandoff.handoffRef.toolCallId, name: 'mobile_ui_action' },
        ],
        timestamp: 105,
      },
    ]);
    params.getGraphSnapshot = jest.fn(() => graph);
    params.applyGraphEvents = jest.fn((events) => {
      graph = reduceAgentControlGraph(graph, events);
    });
    params.publishMobileControllerHandoff = jest.fn(async (handoff) => {
      expect(graph.status).toBe('waiting_async');
      expect(graph.asyncWork.pendingOperations[0]?.mobileControllerHandoff).toBe(
        handoff.handoffRef,
      );
    });

    const result = await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(result.status).toBe('waiting');
    expect(result.workingMessages).toEqual([]);
    expect(graph).toMatchObject({
      status: 'waiting_async',
      pendingAsyncCount: 1,
      expectedToolCalls: [
        { id: deferredHandoff.handoffRef.toolCallId, name: 'mobile_ui_action' },
      ],
      observedToolResults: [],
      asyncWork: {
        pendingOperations: [
          {
            kind: 'mobile-controller-handoff',
            resourceId: deferredHandoff.handoffRef.handoffId,
            mobileControllerHandoff: deferredHandoff.handoffRef,
          },
        ],
      },
    });
    expect(params.onToolMessage).not.toHaveBeenCalled();
    expect(params.publishMobileControllerHandoff).toHaveBeenCalledWith(deferredHandoff);
    expect(params.publishWorkflowToolResultProgress).not.toHaveBeenCalled();
    expect(params.finishWithGraphTerminalEvent).not.toHaveBeenCalled();
    expect(params.onStateChange).not.toHaveBeenCalled();
  });

  it('rejects a deferred mobile handoff that is not the expected graph call', async () => {
    const deferredHandoff = createPersistedMobileControllerHandoffFixture();
    const params = buildBaseParams();
    params.executableToolCalls = [
      { name: 'mobile_ui_action', arguments: JSON.stringify(deferredHandoff.handoff.action) },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: deferredHandoff.handoffRef.toolCallId,
        deferredHandoff,
        effectDispatchObservation: {
          kind: 'deferred',
          handoff: deferredHandoff.handoffRef,
        },
      },
    ];
    const graph = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'MODEL_TURN_STARTED', iteration: 2 },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 2,
        toolCalls: [{ id: 'different-tool-call', name: 'mobile_ui_action' }],
      },
    ]);
    params.getGraphSnapshot = jest.fn(() => graph);

    await expect(resolveAgentControlGraphToolExecutionOutcomes(params)).rejects.toThrow(
      'mobile_controller_handoff_graph_identity_invalid',
    );
    expect(params.applyGraphEvents).not.toHaveBeenCalled();
    expect(params.onToolMessage).not.toHaveBeenCalled();
  });

  it('terminally blocks the graph when an effect requires reconciliation', async () => {
    const params = buildBaseParams();
    params.executableToolCalls = [
      { name: 'write_file', arguments: '{"path":"reports/final.md","content":"done"}' },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-reconcile',
        toolMessage: createToolMessage({
          id: 'tc-reconcile',
          name: 'write_file',
          content: 'Error: tool effect outcome requires reconciliation',
          isError: true,
        }),
        effectReconciliationRequired: true,
      },
    ];

    const result = await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(result.status).toBe('finalized');
    expect(params.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'BLOCKED',
          reason: 'tool_effect_reconciliation_required',
        },
        sessionEndReason: 'tool_effect_reconciliation_required',
      }),
    );
    expect(params.onStateChange).not.toHaveBeenCalledWith('thinking');
    expect(params.recordPostToolFinalTextDirective).not.toHaveBeenCalled();
  });

  it('terminally blocks after a non-recoverable effect was not claimed', async () => {
    const params = buildBaseParams();
    params.executableToolCalls = [
      { name: 'write_file', arguments: '{"path":"reports/final.md","content":"done"}' },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-journal-unavailable',
        toolMessage: createToolMessage({
          id: 'tc-journal-unavailable',
          name: 'write_file',
          content: 'Error: durable journal unavailable',
          isError: true,
        }),
        effectDispatchObservation: {
          kind: 'not_claimed',
          reason: 'journal_unavailable',
        },
      },
    ];

    const result = await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(result.status).toBe('finalized');
    expect(params.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'BLOCKED',
          reason: 'tool_effect_not_claimed',
        },
        sessionEndReason: 'tool_effect_not_claimed',
        content: expect.stringContaining('That action was not executed or claimed as successful'),
      }),
    );
    expect(params.onStateChange).not.toHaveBeenCalledWith('thinking');
    expect(params.recordPostToolFinalTextDirective).not.toHaveBeenCalled();
  });

  it('honors rejected user approval as a truthful cancellation without replanning', async () => {
    const params = buildBaseParams();
    params.executableToolCalls = [
      {
        name: 'sms_compose',
        arguments: '{"recipients":["+12025550147"],"message":"I will arrive at six."}',
      },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-user-rejected',
        toolMessage: createToolMessage({
          id: 'tc-user-rejected',
          name: 'sms_compose',
          content: 'Error: tool "sms_compose" was rejected by user approval',
          isError: true,
        }),
        effectDispatchObservation: {
          kind: 'not_claimed',
          reason: 'user_approval_denied',
        },
      },
    ];

    const result = await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(result.status).toBe('finalized');
    expect(params.finishWithGraphTerminalEvent).toHaveBeenCalledWith({
      graphEvent: {
        type: 'CANCELLED',
        reason: 'user_approval_denied',
      },
      content: expect.stringContaining('No effect was dispatched'),
      assistantMetadata: expect.objectContaining({
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'user_approval_denied',
      }),
      sessionEndReason: 'user_approval_denied',
    });
    expect(params.onStateChange).not.toHaveBeenCalledWith('thinking');
    expect(params.recordPostToolFinalTextDirective).not.toHaveBeenCalled();
  });

  it('allows the model to repair a discoverable pre-dispatch tool failure', async () => {
    const params = buildBaseParams();
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-tool-unknown',
        toolMessage: createToolMessage({
          id: 'tc-tool-unknown',
          name: 'unknown_tool',
          content: 'Error: unknown tool',
          isError: true,
        }),
        effectDispatchObservation: {
          kind: 'not_claimed',
          reason: 'tool_unknown',
        },
      },
    ];

    const result = await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(result.status).toBe('continued');
    expect(params.onStateChange).toHaveBeenCalledWith('thinking');
    expect(params.finishWithGraphTerminalEvent).not.toHaveBeenCalled();
  });

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
    expect(params.onToolMessage).toHaveBeenCalledWith({
      version: 1,
      toolCallId: 'tc1',
      status: 'completed',
      content: 'file body',
    });
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
});
