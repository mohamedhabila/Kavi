import { evaluateE2ERubric } from '../../src/acceptance/e2eAgent/rubricEvaluators';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

type TurnTrace = E2EScenarioResult['turnTraces'][number];

function buildTurn(overrides: Partial<TurnTrace> = {}): TurnTrace {
  return {
    turnIndex: 1,
    lifecycleBefore: {
      boundary: 'app_relaunch',
      chatStore: 'rehydrated',
      memoryStore: 'reopened',
    },
    user: { messageId: 'user-1', text: 'Continue.', timestamp: 10 },
    route: { directive: 'forced_chitchat', mode: 'chitchat', personaId: 'default' },
    finalAssistant: {
      messageId: 'assistant-1',
      text: 'Done.',
      timestamp: 11,
      completionStatus: 'complete',
      finishReason: 'stop',
      terminalReason: null,
    },
    finalAssistantCandidateCount: 1,
    completion: {
      assistantStatus: 'complete',
      executionCompleted: true,
      finalResponseCompleted: true,
      runStatus: 'not_applicable',
      runCompleted: null,
      runCompletedAt: null,
      runTerminalReason: null,
      graphStatus: null,
      graphTerminalReason: null,
    },
    agentRun: null,
    memory: [
      {
        lifecycle: {
          processed: true,
          enqueued: true,
          jobId: 'job-1',
          episodeId: 'episode-1',
          factIds: [],
          activeFocusUpdated: true,
          openThreadsUpdated: false,
          enriched: true,
        },
        job: null,
        receipts: [
          {
            jobId: 'job-1',
            attemptNumber: 1,
            episodeId: 'episode-1',
            deterministicFactIds: [],
            providerFactIds: ['fact-1'],
            invalidatedFactIds: [],
            bridgedEvidenceFactIds: [],
            agentRunMemoryFactIds: [],
            activeFocusUpdated: true,
            openThreadsUpdated: false,
            providerOutcome: 'valid',
            providerOutcomeCode: null,
            persistedAt: 12,
          },
        ],
      },
    ],
    memoryEvidence: {
      delta: {
        capturedAt: 12,
        facts: { createdIds: [], updatedIds: [], removedIds: [] },
        episodes: { createdIds: [], updatedIds: [], removedIds: [] },
        workingBlocks: { createdIds: [], updatedIds: [], removedIds: [] },
        ingestionJobs: { createdIds: [], updatedIds: [], removedIds: [] },
        invalidatedFactIds: [],
        deletedFactIds: [],
        deletedEpisodeIds: [],
        clearedWorkingBlockIds: [],
        completedIngestionJobIds: [],
      },
    },
    native: { stateBefore: {}, stateAfter: {}, invocations: [] } as TurnTrace['native'],
    toolCalls: [],
    toolResults: [],
    graphSnapshots: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      eventCount: 0,
    },
    completed: true,
    ...overrides,
  };
}

function buildResult(turn: TurnTrace = buildTurn()): E2EScenarioResult {
  return {
    contentClass: 'synthetic_public',
    fixtureId: 'stage-attribution',
    conversationId: 'conversation-1',
    toolCalls: [],
    toolResults: [],
    graphSnapshots: [],
    memoryFinalState: {
      capturedAt: 12,
      scope: {
        memoryConversationId: 'conversation-1',
        sourceThreadId: 'conversation-1',
      },
      facts: [],
      episodes: [],
      workingBlocks: [],
      ingestionJobs: [],
    },
    turnTraces: [turn],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      eventCount: 0,
    },
    errors: [],
    completed: true,
    durationMs: 2,
    userTurnCount: 1,
  };
}

describe('turn stage-attribution rubrics', () => {
  it('grades the actual route directive and resolved mode for the requested turn', () => {
    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_route',
        turnIndex: 1,
        directive: 'forced_chitchat',
        mode: 'chitchat',
      }),
    ).toMatchObject({ passed: true });

    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_route',
        turnIndex: 1,
        directive: 'production_auto',
        mode: 'chitchat',
      }),
    ).toMatchObject({ passed: false });
  });

  it('grades execution, final response, and nullable run completion independently', () => {
    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_completion',
        turnIndex: 1,
        executionCompleted: true,
        finalResponseCompleted: true,
        runCompleted: null,
      }),
    ).toMatchObject({ passed: true });

    const runTurn = buildTurn({
      completion: {
        ...buildTurn().completion,
        runStatus: 'completed',
        runCompleted: true,
        runCompletedAt: 12,
      },
    });
    expect(
      evaluateE2ERubric(buildResult(runTurn), {
        kind: 'turn_completion',
        turnIndex: 1,
        executionCompleted: true,
        finalResponseCompleted: true,
        runCompleted: true,
      }),
    ).toMatchObject({ passed: true });
    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_completion',
        turnIndex: 1,
        executionCompleted: true,
        finalResponseCompleted: true,
        runCompleted: false,
      }),
    ).toMatchObject({ passed: false });
  });

  it('requires a durable turn receipt and optionally an exact provider outcome', () => {
    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_memory_receipt',
        turnIndex: 1,
      }),
    ).toMatchObject({ passed: true });
    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_memory_receipt',
        turnIndex: 1,
        providerOutcome: 'valid',
      }),
    ).toMatchObject({ passed: true });

    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_memory_receipt',
        turnIndex: 1,
        providerOutcome: 'provider_error',
      }),
    ).toMatchObject({ passed: false });

    const receiptlessTurn = buildTurn({
      memory: buildTurn().memory.map((snapshot) => ({ ...snapshot, receipts: [] })),
    });
    expect(
      evaluateE2ERubric(buildResult(receiptlessTurn), {
        kind: 'turn_memory_receipt',
        turnIndex: 1,
      }),
    ).toMatchObject({ passed: false });

    const unrelatedReceiptTurn = buildTurn({
      memory: buildTurn().memory.map((snapshot) => ({
        ...snapshot,
        receipts: snapshot.receipts.map((receipt) => ({ ...receipt, jobId: 'other-job' })),
      })),
    });
    expect(
      evaluateE2ERubric(buildResult(unrelatedReceiptTurn), {
        kind: 'turn_memory_receipt',
        turnIndex: 1,
      }),
    ).toMatchObject({ passed: false });
  });

  it('requires an observed, fully reopened app-relaunch boundary on the exact turn', () => {
    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_lifecycle_boundary',
        turnIndex: 1,
        boundary: 'app_relaunch',
      }),
    ).toMatchObject({ passed: true });

    expect(
      evaluateE2ERubric(buildResult(buildTurn({ lifecycleBefore: null })), {
        kind: 'turn_lifecycle_boundary',
        turnIndex: 1,
        boundary: 'app_relaunch',
      }),
    ).toMatchObject({ passed: false });
    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_lifecycle_boundary',
        turnIndex: 2,
        boundary: 'app_relaunch',
      }),
    ).toMatchObject({ passed: false });
  });
});
