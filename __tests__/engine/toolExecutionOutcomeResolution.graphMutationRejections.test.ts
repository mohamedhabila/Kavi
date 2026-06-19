import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import {
  buildBaseParams,
  createGoal,
  createToolMessage,
} from '../helpers/toolExecutionOutcomeHarness';

describe('tool execution outcome resolution', () => {
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
});
