import {
  getE2ENativeMobileFixtureStateSnapshot,
  resetE2ENativeMobileFixtures,
} from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import type {
  E2EScenarioResult,
  E2EScenarioTurnTrace,
} from '../../src/acceptance/e2eAgent/types';
import type { UsageTokenBuckets } from '../../src/types/usage';

export const TOKEN_BUCKETS: UsageTokenBuckets = {
  systemPromptTokens: 11,
  toolDeclarationTokens: 22,
  memoryContextTokens: 33,
  conversationHistoryTokens: 44,
  userTurnTokens: 55,
  toolResultTokens: 66,
};

export function buildFixtureTurnTrace(
  overrides: Partial<E2EScenarioTurnTrace> = {},
): E2EScenarioTurnTrace {
  const nativeState = getE2ENativeMobileFixtureStateSnapshot();
  return {
    turnIndex: 0,
    lifecycleBefore: null,
    user: { messageId: 'user-1', text: 'test prompt', timestamp: 1 },
    route: { directive: 'production_auto', mode: 'chitchat', personaId: 'default' },
    finalAssistant: {
      messageId: 'assistant-1',
      text: 'test response',
      timestamp: 2,
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
    memory: [],
    memoryEvidence: {
      delta: {
        capturedAt: 2,
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
    native: { stateBefore: nativeState, stateAfter: nativeState, invocations: [] },
    retrieval: { sourceThreadIdHash: null, instrumentationStatus: 'missing', events: [] },
    toolCalls: [],
    toolResults: [],
    graphSnapshots: [],
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 0,
      totalTokens: 125,
      eventCount: 1,
    },
    completed: true,
    ...overrides,
  };
}

export function buildFixtureResult(overrides?: Partial<E2EScenarioResult>): E2EScenarioResult {
  return {
    contentClass: 'synthetic_public',
    fixtureId: 'file-write-read',
    conversationId: 'e2e-file-write-read',
    toolCalls: [{ id: 'tc-1', name: 'write_file', arguments: '{}' }],
    toolResults: [],
    graphSnapshots: [{ status: 'finalized' } as E2EScenarioResult['graphSnapshots'][number]],
    memoryFinalState: {
      capturedAt: 1,
      scope: {
        memoryConversationId: 'e2e-file-write-read',
        sourceThreadId: 'e2e-file-write-read',
      },
      facts: [],
      episodes: [],
      workingBlocks: [],
      ingestionJobs: [],
    },
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 0,
      totalTokens: 125,
      eventCount: 1,
    },
    errors: [],
    completed: true,
    durationMs: 1200,
    userTurnCount: 1,
    turnTraces: [],
    ...overrides,
  };
}

export function installE2ERunReportFixtureReset(): void {
  beforeEach(() => {
    resetE2ENativeMobileFixtures();
  });
}
