import { getE2ENativeMobileFixtureStateSnapshot } from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import type { ForegroundScenarioRetrievalEvidence } from '../../src/acceptance/e2eAgent/foregroundScenarioRetrievalEvidence';
import type { E2EScenarioTurnTrace } from '../../src/acceptance/e2eAgent/types';
import type { MemoryRetrievalEvent } from '../../src/services/memory/retrievalEventTypes';
import { buildFixtureResult } from './e2eRunReportHarness';

export const PAIRED_TEST_SOURCE_THREAD_HASH = 'a'.repeat(64);
export const PAIRED_TEST_MEMORY_CONVERSATION_HASH = 'b'.repeat(64);

export function buildPairedRetrievalEvent(
  overrides: Partial<MemoryRetrievalEvent> = {},
): MemoryRetrievalEvent {
  return {
    id: 'retrieval-private-event',
    operation: 'prompt_assembly',
    mode: 'query',
    outcome: 'completed',
    queryFingerprint: {
      hashAlgorithm: 'sha256',
      hash: 'c'.repeat(64),
      length: 10,
      unitCount: 2,
    },
    scope: {
      memoryConversationIdHash: PAIRED_TEST_MEMORY_CONVERSATION_HASH,
      sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
      taskScopePresent: false,
    },
    counts: {
      candidateFactCount: 1,
      selectedFactCount: 1,
      selectedFactIds: ['private-fact-id'],
      candidateEpisodeCount: 1,
      selectedEpisodeCount: 1,
      selectedEpisodeIds: ['private-episode-id'],
    },
    timings: {
      planMs: 1,
      factRecallMs: 2,
      episodeRecallMs: 3,
      candidateFetchMs: 1,
      scoreMs: 1,
      selectorMs: 0,
      evidenceExpansionMs: 1,
      totalMs: 5,
    },
    expansion: {
      outcome: 'completed',
      requestedSourceCount: 2,
      acceptedSourceCount: 2,
      sourceWithEvidenceCount: 1,
      emittedEvidenceCount: 1,
      promptBudgetDroppedCount: 0,
      promptChars: 400,
      durationMs: 1,
    },
    selector: { mode: 'deterministic', outcome: 'not_requested' },
    barrier: null,
    createdAt: 1,
    ...overrides,
  };
}

export function buildPairedTurnTrace(
  retrieval: ForegroundScenarioRetrievalEvidence,
  overrides: Readonly<{
    route?: Pick<E2EScenarioTurnTrace['route'], 'directive' | 'mode'>;
    turnIndex?: number;
  }> = {},
): E2EScenarioTurnTrace {
  const nativeState = getE2ENativeMobileFixtureStateSnapshot();
  return {
    turnIndex: overrides.turnIndex ?? 0,
    lifecycleBefore: null,
    user: { messageId: 'user-1', text: 'test prompt', timestamp: 1 },
    route: {
      ...(overrides.route ?? { directive: 'production_auto', mode: 'chitchat' }),
      personaId: 'default',
    },
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
    retrieval,
    toolCalls: [],
    toolResults: [],
    graphSnapshots: [],
    usage: buildFixtureResult().usage,
    completed: true,
  };
}
