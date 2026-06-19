// ---------------------------------------------------------------------------
// E2E scenario runner — multi-turn structural unit tests (mocked orchestrator)
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import type { AgentRunControlGraphState } from '../../src/types/agentRun';
import { runE2EScenario } from '../../src/acceptance/e2eAgent/scenarioRunner';
import { readWorkspaceRelativeFile } from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import {
  getE2ENativeMobileFixtureStateSnapshot,
  tryExecuteE2ENativeMobileTool,
} from '../../src/engine/tools/e2eNativeCalendarFixtures';
import type { E2EScenario } from '../../src/acceptance/e2eAgent/types';

const mockRunOrchestrator = jest.fn();

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: (...args: unknown[]) => mockRunOrchestrator(...args),
}));

jest.mock('../../src/acceptance/e2eAgent/providerConfig', () => ({
  buildE2EProvider: () => ({
    apiKey: 'test-key',
    model: 'test-model',
    baseUrl: 'https://example.com',
  }),
  isE2EAgentEvalEnabled: () => process.env.RUN_E2E_AGENT_EVAL === '1',
}));

function buildFinalizedGraphSnapshot(
  overrides: Partial<AgentRunControlGraphState> = {},
): AgentRunControlGraphState {
  return {
    version: 1,
    status: 'finalized',
    iteration: 1,
    expectedToolCalls: [],
    observedToolResults: [],
    pendingAsyncCount: 0,
    lastModelToolNames: [],
    asyncWork: { pendingOperations: [], awaitingBackgroundWorkers: false },
    performance: {
      modelTurnCount: 1,
      modelDurationMs: 1,
      toolExecutionCount: 0,
      toolExecutionDurationMs: 0,
      lastCandidateToolCount: 0,
      lastActiveToolCount: 0,
      maxActiveToolCount: 0,
    },
    turnDirectives: {},
    audit: [],
    updatedAt: 1,
    ...overrides,
  };
}

describe('runE2EScenario multi-turn flow', () => {
  const invocationUserTurnCounts: number[] = [];
  const invocationLatestUserContents: string[] = [];

  beforeEach(() => {
    invocationUserTurnCounts.length = 0;
    invocationLatestUserContents.length = 0;
    mockRunOrchestrator.mockReset();
    mockRunOrchestrator.mockImplementation(async (options, callbacks) => {
      const userMessages = options.messages.filter(
        (message: { role: string }) => message.role === 'user',
      );
      invocationUserTurnCounts.push(userMessages.length);
      invocationLatestUserContents.push(userMessages[userMessages.length - 1]?.content ?? '');

      callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
      callbacks.onDone();
    });
  });

  it('invokes orchestrator once per user turn with accumulated messages', async () => {
    const scenario: E2EScenario = {
      id: 'multi-turn-test',
      conversationId: 'conv-multi',
      prompt: 'ignored when userTurns is set',
      userTurns: [{ content: 'Turn one' }, { content: 'Turn two' }],
      rubrics: [{ kind: 'min_user_turns', min: 2 }],
    };

    const result = await runE2EScenario(scenario);

    expect(mockRunOrchestrator).toHaveBeenCalledTimes(2);
    expect(result.userTurnCount).toBe(2);
    expect(result.turnTraces).toHaveLength(2);
    expect(result.completed).toBe(true);

    expect(invocationUserTurnCounts).toEqual([1, 2]);
    expect(invocationLatestUserContents).toEqual(['Turn one', 'Turn two']);

    const secondInvocation = mockRunOrchestrator.mock.calls[1][0];
    expect(secondInvocation.initialAgentControlGraphState?.status).toBe('ready');
  });

  it('seeds workspace files before invoking the orchestrator', async () => {
    mockRunOrchestrator.mockImplementation(async (options, callbacks) => {
      expect(readWorkspaceRelativeFile(options.workspaceConversationId, 'inbox/seed.txt')).toBe(
        'SEEDED-WORKSPACE-CONTENT',
      );
      callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
      callbacks.onDone();
    });

    const scenario: E2EScenario = {
      id: 'workspace-seed-test',
      conversationId: 'conv-workspace-seed',
      prompt: 'Read the seed file.',
      initialWorkspaceFiles: [
        {
          path: 'inbox/seed.txt',
          content: 'SEEDED-WORKSPACE-CONTENT',
        },
      ],
      rubrics: [],
    };

    const result = await runE2EScenario(scenario);

    expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    expect(result.completed).toBe(true);
  });

  it('does not inject graph state on the first turn and resumes from emitted graph snapshots', async () => {
    let invocation = 0;
    mockRunOrchestrator.mockImplementation(async (options, callbacks) => {
      if (invocation === 0) {
        expect(options.initialAgentControlGraphState).toBeUndefined();
      } else {
        expect(options.initialAgentControlGraphState?.status).toBe('ready');
        expect(options.initialAgentControlGraphState?.activeTaskId).toBe('system-derived-goal');
      }
      invocation += 1;
      callbacks.onAgentControlGraphStateChange(
        buildFinalizedGraphSnapshot({
          activeTaskId: 'system-derived-goal',
        }),
      );
      callbacks.onDone();
    });

    const scenario: E2EScenario = {
      id: 'graph-resume-test',
      conversationId: 'conv-graph-resume',
      prompt: 'Create the requested mobile artifact and verify it.',
      userTurns: [{ content: 'Turn one' }, { content: 'Turn two' }],
      rubrics: [],
    };

    await runE2EScenario(scenario);

    expect(mockRunOrchestrator).toHaveBeenCalledTimes(2);
  });

  it('resets native mobile fixtures before invoking the orchestrator', async () => {
    const previousRuntimeFlag = process.env.RUN_E2E_AGENT_EVAL;
    let result;
    try {
      process.env.RUN_E2E_AGENT_EVAL = '1';
      await tryExecuteE2ENativeMobileTool(
        'calendar_create_event',
        JSON.stringify({
          title: 'Leaked event',
          startDate: '2026-06-12T10:00:00Z',
          endDate: '2026-06-12T11:00:00Z',
        }),
      );
      expect(getE2ENativeMobileFixtureStateSnapshot().calendar.createdEventCount).toBe(1);

      mockRunOrchestrator.mockImplementation(async (_options, callbacks) => {
        expect(getE2ENativeMobileFixtureStateSnapshot().calendar.createdEventCount).toBe(0);
        callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
        callbacks.onDone();
      });

      const scenario: E2EScenario = {
        id: 'native-reset-test',
        conversationId: 'conv-native-reset',
        prompt: 'Check native reset.',
        rubrics: [],
      };

      result = await runE2EScenario(scenario);
    } finally {
      if (previousRuntimeFlag === undefined) {
        delete process.env.RUN_E2E_AGENT_EVAL;
      } else {
        process.env.RUN_E2E_AGENT_EVAL = previousRuntimeFlag;
      }
    }
    expect(result.completed).toBe(true);
  });

  it('isolates live eval conversation IDs from fixed scenario IDs', async () => {
    const previousRuntimeFlag = process.env.RUN_E2E_AGENT_EVAL;
    const previousRunId = process.env.E2E_SCENARIO_RUN_ID;
    let invocationConversationId = '';
    let invocationWorkspaceConversationId = '';

    try {
      process.env.RUN_E2E_AGENT_EVAL = '1';
      process.env.E2E_SCENARIO_RUN_ID = 'cache/debug run';
      mockRunOrchestrator.mockImplementation(async (options, callbacks) => {
        invocationConversationId = options.conversationId;
        invocationWorkspaceConversationId = options.workspaceConversationId;
        callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
        callbacks.onDone();
      });

      const scenario: E2EScenario = {
        id: 'live-isolation-test',
        conversationId: 'conv-live-isolation',
        prompt: 'Check live isolation.',
        initialWorkspaceFiles: [{ path: 'seed.txt', content: 'SEEDED' }],
        rubrics: [],
      };

      const result = await runE2EScenario(scenario);

      expect(invocationConversationId).toBe('conv-live-isolation-cache-debug-run');
      expect(invocationWorkspaceConversationId).toBe(invocationConversationId);
      expect(result.conversationId).toBe(invocationConversationId);
      expect(readWorkspaceRelativeFile(result.conversationId, 'seed.txt')).toBe('SEEDED');
      expect(readWorkspaceRelativeFile(scenario.conversationId, 'seed.txt')).toBeUndefined();
    } finally {
      if (previousRuntimeFlag === undefined) {
        delete process.env.RUN_E2E_AGENT_EVAL;
      } else {
        process.env.RUN_E2E_AGENT_EVAL = previousRuntimeFlag;
      }
      if (previousRunId === undefined) {
        delete process.env.E2E_SCENARIO_RUN_ID;
      } else {
        process.env.E2E_SCENARIO_RUN_ID = previousRunId;
      }
    }
  });

  it('passes an abort signal into each orchestrator invocation', async () => {
    const scenario: E2EScenario = {
      id: 'abort-signal-test',
      conversationId: 'conv-abort-signal',
      prompt: 'Check signal.',
      rubrics: [],
    };

    await runE2EScenario(scenario);

    const invocation = mockRunOrchestrator.mock.calls[0]?.[0];
    expect(invocation?.signal).toBeInstanceOf(AbortController);
    expect(invocation?.signal.signal.aborted).toBe(false);
  });

  it('persists terminal assistant metadata for empty-content no-tool turns', async () => {
    mockRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onAssistantMessage('', [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      });
      callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
      callbacks.onDone();
    });

    const scenario: E2EScenario = {
      id: 'terminal-metadata-test',
      conversationId: 'conv-terminal',
      prompt: 'Passive turn',
      rubrics: [],
    };

    const result = await runE2EScenario(scenario);
    const conversationMessages = mockRunOrchestrator.mock.calls[0][0].messages as Array<{
      role: string;
      assistantMetadata?: { kind: string };
    }>;
    const assistantMessages = conversationMessages.filter(
      (message) => message.role === 'assistant',
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.assistantMetadata?.kind).toBe('final');
    expect(result.completed).toBe(true);
  });

  it('flushes streamed assistant tokens on done when no assistant message was persisted', async () => {
    mockRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onToken('streamed ');
      callbacks.onToken('reply');
      callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
      callbacks.onDone();
    });

    const scenario: E2EScenario = {
      id: 'stream-flush-test',
      conversationId: 'conv-stream-flush',
      prompt: 'Passive streamed reply',
      rubrics: [],
    };

    await runE2EScenario(scenario);
    const conversationMessages = mockRunOrchestrator.mock.calls[0][0].messages as Array<{
      role: string;
      content?: string;
      assistantMetadata?: { kind: string };
    }>;
    const assistant = conversationMessages.find((message) => message.role === 'assistant');
    expect(assistant?.content).toBe('streamed reply');
    expect(assistant?.assistantMetadata?.kind).toBe('final');
  });

  it('records canonical non-error tool results for sequential calendar batch trace', async () => {
    mockRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onToolCallStart({
        id: 'tc-calendar-list',
        name: 'google_calendar:calendar_list',
        arguments: '{}',
        status: 'pending',
      });
      await callbacks.onToolMessage(
        'tc-calendar-list',
        JSON.stringify([{ id: 'cal-1', title: 'Work' }]),
      );
      callbacks.onToolCallStart({
        id: 'tc-calendar-events',
        name: 'google_calendar:calendar_events',
        arguments: '{"calendarId":"cal-1"}',
        status: 'pending',
      });
      await callbacks.onToolMessage('tc-calendar-events', JSON.stringify([]));
      callbacks.onAssistantMessage('Listed calendars and events.', []);
      callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
      callbacks.onDone();
    });

    const scenario: E2EScenario = {
      id: 'calendar-batch-trace-test',
      conversationId: 'conv-calendar-batch',
      prompt: 'List calendars then events',
      rubrics: [],
    };

    const result = await runE2EScenario(scenario);
    const turnTrace = result.turnTraces[0];

    expect(turnTrace?.toolCalls).toEqual([
      {
        id: 'tc-calendar-list',
        name: 'calendar_list',
        arguments: '{}',
      },
      {
        id: 'tc-calendar-events',
        name: 'calendar_events',
        arguments: '{"calendarId":"cal-1"}',
      },
    ]);
    expect(turnTrace?.toolResults).toEqual([
      {
        toolCallId: 'tc-calendar-list',
        name: 'calendar_list',
        content: JSON.stringify([{ id: 'cal-1', title: 'Work' }]),
        isError: false,
      },
      {
        toolCallId: 'tc-calendar-events',
        name: 'calendar_events',
        content: JSON.stringify([]),
        isError: false,
      },
    ]);
  });

  it('records canonical update_goals result content and graph-applied trace state', async () => {
    const canonicalResult = JSON.stringify({
      status: 'ok',
      action: 'complete',
      goals: [
        {
          id: 'goal-a',
          title: 'Collect sources',
          status: 'completed',
          completionPolicy: 'blocking',
          dependencies: [],
          evidence: ['read_file:source-a.md'],
          successCriteria: ['evidence.min:1'],
        },
      ],
    });

    mockRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onToolCallStart({
        id: 'tc-goals',
        name: 'update_goals',
        arguments: '{"action":"complete","id":"goal-a"}',
        status: 'pending',
      });
      await callbacks.onToolMessage('tc-goals', canonicalResult);
      callbacks.onAgentControlGraphStateChange({
        ...buildFinalizedGraphSnapshot(),
        observedToolResults: [
          {
            id: 'tc-goals',
            name: 'update_goals',
            canonicalized: true,
            graphApplied: true,
          },
        ],
        goals: [
          {
            id: 'goal-a',
            title: 'Collect sources',
            status: 'completed',
            completionPolicy: 'blocking',
            dependencies: [],
            evidence: ['read_file:source-a.md'],
            successCriteria: ['evidence.min:1'],
            createdAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
        ],
      });
      callbacks.onDone();
    });

    const scenario: E2EScenario = {
      id: 'canonical-update-goals-trace-test',
      conversationId: 'conv-canonical-goals',
      prompt: 'Complete the active goal.',
      rubrics: [],
    };

    const result = await runE2EScenario(scenario);

    expect(result.toolResults).toEqual([
      {
        toolCallId: 'tc-goals',
        name: 'update_goals',
        content: canonicalResult,
        isError: false,
      },
    ]);
    expect(result.graphSnapshots.at(-1)?.observedToolResults).toEqual([
      {
        id: 'tc-goals',
        name: 'update_goals',
        canonicalized: true,
        graphApplied: true,
      },
    ]);
    expect(result.graphSnapshots.at(-1)?.goals?.[0]).toEqual(
      expect.objectContaining({
        id: 'goal-a',
        status: 'completed',
      }),
    );
  });

  it('uses prompt as a single user turn when userTurns is omitted', async () => {
    const scenario: E2EScenario = {
      id: 'single-turn-test',
      conversationId: 'conv-single',
      prompt: 'Single prompt',
      rubrics: [],
    };

    const result = await runE2EScenario(scenario);

    expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    expect(result.userTurnCount).toBe(1);
  });
});
