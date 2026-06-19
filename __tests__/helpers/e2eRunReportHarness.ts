import { resetE2ENativeMobileFixtures } from '../../src/engine/tools/e2eNativeCalendarFixtures';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
import type { UsageTokenBuckets } from '../../src/types/usage';

export const TOKEN_BUCKETS: UsageTokenBuckets = {
  systemPromptTokens: 11,
  toolDeclarationTokens: 22,
  memoryContextTokens: 33,
  conversationHistoryTokens: 44,
  userTurnTokens: 55,
  toolResultTokens: 66,
};

export function buildFixtureResult(
  overrides?: Partial<E2EScenarioResult>,
): E2EScenarioResult {
  return {
    fixtureId: 'file-write-read',
    conversationId: 'e2e-file-write-read',
    toolCalls: [{ id: 'tc-1', name: 'write_file', arguments: '{}' }],
    toolResults: [],
    graphSnapshots: [{ status: 'finalized' } as E2EScenarioResult['graphSnapshots'][number]],
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
