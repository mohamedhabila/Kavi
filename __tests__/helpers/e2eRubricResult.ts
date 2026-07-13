import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
import {
  buildScopedMemoryEvidenceDelta,
  captureScopedMemoryEvidence,
} from '../../src/services/memory/evidenceSnapshot';

export function buildE2ERubricResult(
  overrides: Partial<E2EScenarioResult> = {},
): E2EScenarioResult {
  return {
    contentClass: 'synthetic_public',
    fixtureId: 'fixture-a',
    conversationId: 'conv-a',
    toolCalls: [],
    toolResults: [],
    graphSnapshots: [],
    memoryFinalState: {
      capturedAt: 1,
      scope: { memoryConversationId: 'conv-a', sourceThreadId: 'conv-a' },
      facts: [],
      episodes: [],
      workingBlocks: [],
      ingestionJobs: [],
    },
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
    durationMs: 1,
    userTurnCount: 1,
    turnTraces: [],
    ...overrides,
  };
}

export function buildE2ERubricResultWithMemoryEvidence(
  conversationId: string,
  overrides: Partial<E2EScenarioResult> = {},
): E2EScenarioResult {
  const scope = { memoryConversationId: conversationId, sourceThreadId: conversationId };
  const before = {
    capturedAt: 0,
    scope,
    facts: [],
    episodes: [],
    workingBlocks: [],
    ingestionJobs: [],
  };
  const after = captureScopedMemoryEvidence(scope);
  return buildE2ERubricResult({
    conversationId,
    memoryFinalState: after,
    ...overrides,
    turnTraces: [
      {
        memoryEvidence: {
          delta: buildScopedMemoryEvidenceDelta(before, after),
        },
      } as E2EScenarioResult['turnTraces'][number],
    ],
  });
}
