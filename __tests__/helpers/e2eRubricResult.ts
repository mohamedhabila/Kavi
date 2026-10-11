import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';

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
    memoryItems: { capturedAt: 1, items: [], indexedTurnCount: 0 },
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
