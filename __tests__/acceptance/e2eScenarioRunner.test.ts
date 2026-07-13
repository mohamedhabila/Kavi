jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runE2EScenario } from '../../src/acceptance/e2eAgent/scenarioRunner';
import { buildE2EScenarioTraceSummary } from '../../src/acceptance/e2eAgent/e2eTraceSummary';
import { evaluateE2ERubric } from '../../src/acceptance/e2eAgent/rubricEvaluators';
import { buildForegroundScenarioCompletionSnapshot } from '../../src/acceptance/e2eAgent/foregroundScenarioDriverRuntime';
import {
  getE2ENativeMobileFixtureStateSnapshot,
  resetE2ENativeMobileFixtures,
  tryExecuteE2ENativeMobileTool,
} from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import { readWorkspaceRelativeFile } from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import type { E2EScenario } from '../../src/acceptance/e2eAgent/types';
import { runOrchestrator } from '../../src/engine/orchestrator';
import {
  cancelScheduledIngestionDrain,
  getIngestionJob,
  type IngestionJob,
} from '../../src/services/memory/ingestionQueue';
import { recordCompletedTurnForMemory } from '../../src/services/memory/lifecycle';
import type { AgentRun, AgentRunControlGraphState } from '../../src/types/agentRun';
import type { LlmProviderConfig } from '../../src/types/provider';
import { buildAssistantMessageMetadata } from '../../src/utils/assistantMessageMetadata';

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn(),
}));
jest.mock('../../src/services/memory/ingestionQueue', () => ({
  cancelScheduledIngestionDrain: jest.fn(),
  requestScheduledIngestionDrain: jest.fn(() => false),
  drainIngestionQueueWithWakeup: jest.fn(async () => ({
    attempted: 0,
    completed: 0,
    completedStructural: 0,
    completedEnriched: 0,
    retrying: 0,
    degraded: 0,
    deferred: 0,
    resourceDeferred: 0,
    failed: 0,
  })),
  getIngestionJob: jest.fn(),
}));
jest.mock('../../src/services/memory/lifecycle', () => ({
  loadIngestionJobRuntimeContext: jest.fn(() => ({})),
  recordCompletedTurnForMemory: jest.fn(),
}));
jest.mock('../../src/store/chatStorePersistence', () => ({
  flushChatStorePersistenceNow: jest.fn(async () => undefined),
  requestChatStorePersistenceCheckpoint: jest.fn(),
}));

const MOCK_E2E_PROVIDER: LlmProviderConfig = {
  id: 'e2e-test-provider',
  name: 'E2E test provider',
  enabled: true,
  kind: 'remote',
  protocol: 'openai-chat',
  providerFamily: 'custom',
  apiKey: 'test-key',
  model: 'test-model',
  baseUrl: 'https://example.com',
};

jest.mock('../../src/acceptance/e2eAgent/providerConfig', () => ({
  buildE2EProvider: () => ({ ...MOCK_E2E_PROVIDER }),
  isE2EAgentEvalEnabled: () => process.env.RUN_E2E_AGENT_EVAL === '1',
}));

const mockedRunOrchestrator = jest.mocked(runOrchestrator);
const mockedRecordCompletedTurnForMemory = jest.mocked(recordCompletedTurnForMemory);
const mockedGetIngestionJob = jest.mocked(getIngestionJob);
const mockedCancelScheduledIngestionDrain = jest.mocked(cancelScheduledIngestionDrain);
const completedOrchestratorRun = { terminalDisposition: 'final_candidate' as const };

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
    asyncWork: { pendingOperations: [], awaitingBackgroundWorkers: false, updatedAt: 1 },
    performance: {
      modelTurnCount: 1,
      modelDurationMs: 1,
      toolExecutionCount: 0,
      toolExecutionDurationMs: 0,
      lastCandidateToolCount: 0,
      lastActiveToolCount: 0,
      maxActiveToolCount: 0,
      lastActiveToolTokenEstimate: 0,
      maxActiveToolTokenEstimate: 0,
      updatedAt: 1,
    },
    turnDirectives: {
      forceFinalText: false,
      requireWorkflowTool: false,
      incompleteFinalTextRecoveryCount: 0,
    },
    audit: [],
    updatedAt: 1,
    ...overrides,
  };
}

function makeCompletedJob(id: string, sourceEndMessageId = `assistant-${id}`): IngestionJob {
  return {
    id,
    threadId: 'scenario-conversation',
    threadTitle: 'Scenario title',
    memoryConversationId: 'scenario-conversation',
    taskId: null,
    sourceRunId: null,
    chatProviderId: MOCK_E2E_PROVIDER.id,
    chatModel: MOCK_E2E_PROVIDER.model,
    sourceStartMessageId: null,
    sourceEndMessageId,
    sourceAt: 1,
    reason: 'turn_completed',
    status: 'completed_enriched',
    attemptCount: 1,
    providerEnrichment: true,
    providerOutcome: 'valid',
    outcomeCode: null,
    nextAttemptAt: null,
    leaseExpiresAt: null,
    claimToken: null,
    structuralCompletedAt: 2,
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2,
  };
}

function scenario(overrides: Partial<E2EScenario> = {}): E2EScenario {
  return {
    id: 'scenario-test',
    conversationId: 'scenario-conversation',
    contentClass: 'synthetic_public',
    execution: { initialMode: 'agentic', route: 'forced_agentic' },
    prompt: 'Run the product path.',
    rubrics: [],
    ...overrides,
  };
}

describe('runE2EScenario product foreground integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const jobs = new Map<string, IngestionJob>();
    const jobsBySource = new Map<string, IngestionJob>();
    let memorySequence = 0;
    mockedRecordCompletedTurnForMemory.mockImplementation(async (input) => {
      const duplicate = jobsBySource.get(input.sourceEndMessageId);
      if (duplicate) {
        return {
          processed: true,
          enqueued: true,
          jobId: duplicate.id,
          episodeId: null,
          factIds: [],
          activeFocusUpdated: true,
          openThreadsUpdated: false,
          enriched: true,
        };
      }
      const jobId = `job-${++memorySequence}`;
      const job = makeCompletedJob(jobId, input.sourceEndMessageId);
      jobs.set(jobId, job);
      jobsBySource.set(input.sourceEndMessageId, job);
      return {
        processed: true,
        enqueued: true,
        jobId,
        episodeId: null,
        factIds: [],
        activeFocusUpdated: true,
        openThreadsUpdated: false,
        enriched: true,
      };
    });
    mockedGetIngestionJob.mockImplementation((jobId) => jobs.get(jobId) ?? null);

    mockedRunOrchestrator.mockImplementation(async (options, callbacks) => {
      callbacks.onAssistantMessage(
        'Completed response.',
        undefined,
        undefined,
        buildAssistantMessageMetadata('final'),
      );
      callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
      callbacks.onUsage?.({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        model: options.model,
      });
      callbacks.onDone();
      return completedOrchestratorRun;
    });
  });

  it('runs every turn through the product executor with accumulated conversation history', async () => {
    const userTurnCounts: number[] = [];
    mockedRunOrchestrator.mockImplementation(async (options, callbacks) => {
      userTurnCounts.push(options.messages.filter((message) => message.role === 'user').length);
      callbacks.onAssistantMessage(
        `Response ${userTurnCounts.length}`,
        undefined,
        undefined,
        buildAssistantMessageMetadata('final'),
      );
      callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
      callbacks.onDone();
      return completedOrchestratorRun;
    });

    const result = await runE2EScenario(
      scenario({
        userTurns: [{ content: 'Turn one' }, { content: 'Turn two' }],
      }),
    );

    expect(userTurnCounts).toEqual([1, 2]);
    expect(mockedRunOrchestrator).toHaveBeenCalledTimes(2);
    expect(mockedRecordCompletedTurnForMemory).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ completed: true, userTurnCount: 2 });
    expect(result.estimatedCost).toEqual({ status: 'unavailable', usd: null });
    expect(result.memoryFinalState.scope).toEqual({
      memoryConversationId: 'scenario-conversation',
      sourceThreadId: 'scenario-conversation',
    });
    expect(result.turnTraces).toHaveLength(2);
    expect(result.turnTraces[0]).toMatchObject({
      user: { text: 'Turn one' },
      route: { directive: 'forced_agentic', mode: 'agentic', personaId: 'super-agent' },
      finalAssistant: { text: 'Response 1', completionStatus: 'complete' },
      finalAssistantCandidateCount: 1,
      completion: {
        assistantStatus: 'complete',
        executionCompleted: true,
        finalResponseCompleted: true,
        runStatus: 'completed',
        runCompleted: true,
        graphStatus: 'finalized',
      },
      agentRun: {
        status: 'completed',
        currentPhase: 'deliver',
        terminalReason: null,
      },
      memory: [
        {
          lifecycle: { processed: true, enqueued: true },
          job: { status: 'completed_enriched' },
        },
      ],
    });
    expect(result.graphSnapshots.at(-1)?.status).toBe('finalized');
  });

  it('supports production-auto, forced-agentic, and forced-chitchat routes per turn', async () => {
    const result = await runE2EScenario(
      scenario({
        contentClass: 'synthetic_public',
        execution: { initialMode: 'chitchat', route: 'production_auto' },
        userTurns: [
          { content: 'Talk naturally.' },
          { content: 'Complete this task.', route: 'forced_agentic' },
          { content: 'Talk naturally again.', route: 'forced_chitchat' },
        ],
      }),
    );

    expect(mockedRunOrchestrator).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ personaId: 'default' }),
      expect.any(Object),
    );
    expect(mockedRunOrchestrator).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ personaId: 'super-agent' }),
      expect.any(Object),
    );
    expect(mockedRunOrchestrator).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ personaId: 'default' }),
      expect.any(Object),
    );
    expect(result.completed).toBe(true);
    expect(mockedRecordCompletedTurnForMemory).toHaveBeenCalledTimes(3);
  });

  it('maps user-selected modes without replacing production_auto route evidence', async () => {
    const result = await runE2EScenario(
      scenario({
        execution: { initialMode: 'chitchat', route: 'production_auto' },
        userTurns: [
          { content: 'Complete this task.', selectedMode: 'agentic' },
          { content: 'Now return to chat.', selectedMode: 'chitchat' },
        ],
      }),
    );

    expect(result.turnTraces.map((turn) => turn.route)).toEqual([
      { directive: 'production_auto', mode: 'agentic', personaId: 'super-agent' },
      { directive: 'production_auto', mode: 'chitchat', personaId: 'default' },
    ]);
  });

  it('keeps a forced diagnostic route authoritative over the invariant user mode choice', async () => {
    const result = await runE2EScenario(
      scenario({
        execution: { initialMode: 'agentic', route: 'production_auto' },
        userTurns: [{ content: 'Talk naturally.', selectedMode: 'chitchat' }],
      }),
      { routeOverride: 'forced_agentic' },
    );

    expect(result.turnTraces[0]?.route).toEqual({
      directive: 'forced_agentic',
      mode: 'agentic',
      personaId: 'super-agent',
    });
  });

  it('seeds workspace files before invoking the product executor', async () => {
    mockedRunOrchestrator.mockImplementation(async (options, callbacks) => {
      expect(readWorkspaceRelativeFile(options.workspaceConversationId, 'inbox/seed.txt')).toBe(
        'SEEDED-WORKSPACE-CONTENT',
      );
      callbacks.onAssistantMessage(
        'Seed read.',
        undefined,
        undefined,
        buildAssistantMessageMetadata('final'),
      );
      callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
      callbacks.onDone();
      return completedOrchestratorRun;
    });

    const result = await runE2EScenario(
      scenario({
        initialWorkspaceFiles: [{ path: 'inbox/seed.txt', content: 'SEEDED-WORKSPACE-CONTENT' }],
      }),
    );

    expect(result.completed).toBe(true);
  });

  it('maps persisted tool calls and tool results with canonical names', async () => {
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      const call = {
        id: 'tc-calendar-list',
        name: 'google_calendar:calendar_list',
        arguments: '{}',
        status: 'running' as const,
        startedAt: 1,
      };
      callbacks.onToolCallStart(call);
      callbacks.onToolCallComplete({
        ...call,
        status: 'completed',
        result: JSON.stringify([{ id: 'cal-1', title: 'Work' }]),
        completedAt: 2,
      });
      await callbacks.onToolMessage(call.id, JSON.stringify([{ id: 'cal-1', title: 'Work' }]));
      callbacks.onAssistantMessage(
        'Listed calendars.',
        undefined,
        undefined,
        buildAssistantMessageMetadata('final'),
      );
      callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
      callbacks.onDone();
      return completedOrchestratorRun;
    });

    const result = await runE2EScenario(scenario());

    expect(result.toolCalls).toEqual([
      { id: 'tc-calendar-list', name: 'calendar_list', arguments: '{}' },
    ]);
    expect(result.toolResults).toEqual([
      {
        toolCallId: 'tc-calendar-list',
        name: 'calendar_list',
        content: JSON.stringify([{ id: 'cal-1', title: 'Work' }]),
        isError: false,
      },
    ]);
  });

  it('maps the latest persisted control graph for each agentic turn', async () => {
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onAssistantMessage(
        'Goal complete.',
        undefined,
        undefined,
        buildAssistantMessageMetadata('final'),
      );
      callbacks.onAgentControlGraphStateChange(
        buildFinalizedGraphSnapshot({
          activeTaskId: 'goal-a',
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
        }),
      );
      callbacks.onDone();
      return completedOrchestratorRun;
    });

    const result = await runE2EScenario(scenario());

    expect(result.graphSnapshots).toHaveLength(1);
    expect(result.graphSnapshots[0]?.goals?.[0]).toMatchObject({
      id: 'goal-a',
      status: 'completed',
    });
  });

  it('stops after a product execution error and reports incomplete execution', async () => {
    mockedRunOrchestrator.mockRejectedValueOnce(new Error('provider unavailable'));

    const result = await runE2EScenario(
      scenario({ userTurns: [{ content: 'First turn' }, { content: 'Second turn' }] }),
    );

    expect(mockedRunOrchestrator).toHaveBeenCalledTimes(1);
    expect(result.completed).toBe(false);
    expect(result.turnTraces).toHaveLength(1);
    expect(result.errors).toContain('provider unavailable');
  });

  it('recovers a yielded final candidate before reporting execution complete', async () => {
    mockedRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onAssistantMessage(
        'The action is still pending.',
        undefined,
        undefined,
        buildAssistantMessageMetadata('final', {
          completionStatus: 'complete',
          finishReason: 'yielded',
        }),
      );
      callbacks.onAgentControlGraphStateChange(
        buildFinalizedGraphSnapshot({ status: 'yielded', terminalReason: 'pending_async_work' }),
      );
      callbacks.onDone();
      return { terminalDisposition: 'yielded' as const };
    });

    const result = await runE2EScenario(scenario());

    expect(result.errors).toEqual([]);
    expect(mockedRunOrchestrator).toHaveBeenCalledTimes(2);
    expect(result.completed).toBe(true);
    expect(result.turnTraces[0]?.memory).toHaveLength(1);
    expect(result.turnTraces[0]?.finalAssistantCandidateCount).toBe(1);
    expect(result.turnTraces[0]).toMatchObject({
      finalAssistant: {
        text: 'Completed response.',
        completionStatus: 'complete',
      },
      completion: {
        assistantStatus: 'complete',
        executionCompleted: true,
        finalResponseCompleted: true,
        runStatus: 'completed',
        runCompleted: true,
        graphStatus: 'finalized',
        graphTerminalReason: null,
      },
    });
  });

  it('keeps final-response, run, and graph completion evidence independent', () => {
    const run: AgentRun = {
      id: 'run-independent-evidence',
      userMessageId: 'user-independent-evidence',
      goal: 'Demonstrate independent completion evidence.',
      status: 'completed',
      createdAt: 1,
      updatedAt: 2,
      completedAt: 2,
      currentPhase: 'deliver',
      phases: [],
      checkpoints: [],
      summary: {
        assistantTurns: 1,
        startedTools: 0,
        completedTools: 0,
        failedTools: 0,
        spawnedSubAgents: 0,
      },
      controlGraph: buildFinalizedGraphSnapshot({
        status: 'yielded',
        terminalReason: 'pending_async_work',
      }),
    };

    expect(
      buildForegroundScenarioCompletionSnapshot({
        error: null,
        finalAssistant: {
          messageId: 'assistant-independent-evidence',
          text: 'The action is still pending.',
          timestamp: 2,
          completionStatus: 'complete',
          finishReason: 'yielded',
          terminalReason: null,
        },
        route: { mode: 'agentic', personaId: 'agentic' },
        run,
        timedOut: false,
      }),
    ).toMatchObject({
      assistantStatus: 'complete',
      executionCompleted: false,
      finalResponseCompleted: true,
      runStatus: 'completed',
      runCompleted: true,
      graphStatus: 'yielded',
      graphTerminalReason: 'pending_async_work',
    });
  });

  it('resets native fixtures and isolates live-eval conversation ids', async () => {
    const previousRuntimeFlag = process.env.RUN_E2E_AGENT_EVAL;
    const previousRunId = process.env.E2E_SCENARIO_RUN_ID;
    try {
      process.env.RUN_E2E_AGENT_EVAL = '1';
      process.env.E2E_SCENARIO_RUN_ID = 'cache/debug run';
      await tryExecuteE2ENativeMobileTool(
        'calendar_create_event',
        JSON.stringify({
          title: 'Leaked event',
          startDate: '2026-06-12T10:00:00Z',
          endDate: '2026-06-12T11:00:00Z',
        }),
      );

      mockedRunOrchestrator.mockImplementation(async (options, callbacks) => {
        expect(getE2ENativeMobileFixtureStateSnapshot().calendar.createdEventCount).toBe(0);
        expect(options.conversationId).toBe(
          'scenario-conversation-cache-debug-run-paired-condition-a',
        );
        expect(options.workspaceConversationId).toBe(options.conversationId);
        callbacks.onAssistantMessage(
          'Isolated.',
          undefined,
          undefined,
          buildAssistantMessageMetadata('final'),
        );
        callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
        callbacks.onDone();
        return completedOrchestratorRun;
      });

      const result = await runE2EScenario(scenario(), {
        conversationIdSuffix: 'paired-condition-a',
      });
      expect(result.conversationId).toBe(
        'scenario-conversation-cache-debug-run-paired-condition-a',
      );
    } finally {
      if (previousRuntimeFlag === undefined) delete process.env.RUN_E2E_AGENT_EVAL;
      else process.env.RUN_E2E_AGENT_EVAL = previousRuntimeFlag;
      if (previousRunId === undefined) delete process.env.E2E_SCENARIO_RUN_ID;
      else process.env.E2E_SCENARIO_RUN_ID = previousRunId;
    }
  });

  it('uses prompt as the only turn and always disposes driver maintenance', async () => {
    const result = await runE2EScenario(scenario({ prompt: 'Single prompt' }));

    expect(mockedRunOrchestrator).toHaveBeenCalledTimes(1);
    expect(result.userTurnCount).toBe(1);
    expect(result.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      eventCount: 1,
    });
    expect(result.estimatedCost.status).toBe('available');
    expect(result.estimatedCost.usd).toBeCloseTo(0.000025, 12);
    expect(mockedCancelScheduledIngestionDrain).toHaveBeenCalledTimes(1);
  });

  it('requires and preserves the scenario content classification', async () => {
    const result = await runE2EScenario(scenario({ contentClass: 'private' }));
    expect(result.contentClass).toBe('private');

    const invalidScenario = {
      ...scenario(),
      contentClass: undefined,
    } as unknown as E2EScenario;
    await expect(runE2EScenario(invalidScenario)).rejects.toThrow(
      'Scenario contentClass must be private or synthetic_public.',
    );
  });

  it('grades and reports native side effects from immutable per-turn evidence', async () => {
    mockedRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      await tryExecuteE2ENativeMobileTool(
        'clipboard_write',
        JSON.stringify({ text: 'PRIVATE-NATIVE-EVIDENCE' }),
      );
      callbacks.onAssistantMessage(
        'Clipboard updated.',
        undefined,
        undefined,
        buildAssistantMessageMetadata('final'),
      );
      callbacks.onAgentControlGraphStateChange(buildFinalizedGraphSnapshot());
      callbacks.onDone();
      return completedOrchestratorRun;
    });

    const result = await runE2EScenario(scenario({ contentClass: 'private' }));
    const traceBeforeGlobalMutation = buildE2EScenarioTraceSummary({ result });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.turnTraces[0]?.native)).toBe(true);
    expect(result.turnTraces[0]?.native).toMatchObject({
      stateBefore: { clipboard: { text: '', writeCount: 0 } },
      stateAfter: { clipboard: { text: 'PRIVATE-NATIVE-EVIDENCE', writeCount: 1 } },
      invocations: [
        {
          sequence: 1,
          toolName: 'clipboard_write',
          handled: true,
          resultStatus: 'clipboard_written',
          errorClass: null,
        },
      ],
    });
    expect(traceBeforeGlobalMutation.turns[0]?.native).toMatchObject({
      invocationCount: 1,
      handledInvocationCount: 1,
      changedStateFieldCount: 2,
      toolInvocations: [
        expect.objectContaining({
          nameHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
          count: 1,
        }),
      ],
    });

    resetE2ENativeMobileFixtures();
    await tryExecuteE2ENativeMobileTool('calendar_list', '{}');
    expect(
      evaluateE2ERubric(result, {
        kind: 'native_fixture_state',
        path: 'clipboard.writeCount',
        expectedValue: '1',
      }),
    ).toMatchObject({ passed: true });
    expect(buildE2EScenarioTraceSummary({ result })).toEqual(traceBeforeGlobalMutation);
    expect(JSON.stringify(traceBeforeGlobalMutation)).not.toContain('PRIVATE-NATIVE-EVIDENCE');
  });
});
