import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import {
  applyGoalGraphEvents,
  buildBaseParams,
  createGoal,
  createPendingOperation,
  createToolMessage,
} from '../helpers/toolExecutionOutcomeHarness';

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
});
