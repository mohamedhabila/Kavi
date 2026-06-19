import { evaluateE2EScenario } from '../../src/acceptance/e2eAgent/rubricEvaluators';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});
function buildResult(overrides: Partial<E2EScenarioResult> = {}): E2EScenarioResult {
  return {
    fixtureId: 'fixture-a',
    conversationId: 'conv-a',
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
    errors: [],
    completed: true,
    durationMs: 1,
    userTurnCount: 1,
    turnTraces: [],
    ...overrides,
  };
}

describe('evaluateE2EScenario', () => {
  it('aggregates rubric failures into scenario outcome', () => {
    const outcome = evaluateE2EScenario(buildResult({ completed: false }), [
      { kind: 'graph_terminal_success' },
    ]);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain('orchestrator did not complete');
  });
});
