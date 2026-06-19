import { runE2EScenarioWithRetry } from '../../src/acceptance/e2eAgent/e2eScenarioRetry';
import { evaluateE2EScenario } from '../../src/acceptance/e2eAgent/rubricEvaluators';
import { runE2EScenario } from '../../src/acceptance/e2eAgent/scenarioRunner';
import type { E2EScenario } from '../../src/acceptance/e2eAgent/types';

jest.mock('../../src/acceptance/e2eAgent/scenarioRunner', () => ({
  runE2EScenario: jest.fn(),
}));

jest.mock('../../src/acceptance/e2eAgent/sandboxWorkspace', () => ({
  resetE2EWorkspaceSandbox: jest.fn(),
}));

jest.mock('../../src/acceptance/e2eAgent/sandboxMemory', () => ({
  resetE2EMemorySandbox: jest.fn(),
}));

const mockedRunE2EScenario = runE2EScenario as jest.MockedFunction<typeof runE2EScenario>;

const scenario: E2EScenario = {
  id: 'retry-fixture',
  conversationId: 'e2e-retry',
  prompt: 'structural prompt',
  rubrics: [{ kind: 'graph_terminal_success' }],
};

function buildResult(completed: boolean) {
  return {
    fixtureId: scenario.id,
    conversationId: scenario.conversationId,
    toolCalls: [],
    toolResults: [],
    graphSnapshots: completed ? [{ status: 'finalized' }] : [],
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
      eventCount: 1,
    },
    errors: completed ? [] : ['orchestrator timeout'],
    completed,
    durationMs: 10,
    userTurnCount: 1,
    turnTraces: [],
  };
}

describe('e2eScenarioRetry', () => {
  beforeEach(() => {
    mockedRunE2EScenario.mockReset();
  });

  it('runE2EScenarioWithRetry retries until rubrics pass', async () => {
    mockedRunE2EScenario
      .mockResolvedValueOnce(buildResult(false))
      .mockResolvedValueOnce(buildResult(true));

    const attempt = await runE2EScenarioWithRetry(scenario, { maxRetries: 1 });

    expect(mockedRunE2EScenario).toHaveBeenCalledTimes(2);
    expect(attempt.attemptCount).toBe(2);
    expect(attempt.outcome.passed).toBe(true);
    expect(evaluateE2EScenario(attempt.result, scenario.rubrics).passed).toBe(true);
  });

  it('runE2EScenarioWithRetry stops after max retries when rubrics keep failing', async () => {
    mockedRunE2EScenario.mockResolvedValue(buildResult(false));

    const attempt = await runE2EScenarioWithRetry(scenario, { maxRetries: 1 });

    expect(mockedRunE2EScenario).toHaveBeenCalledTimes(2);
    expect(attempt.attemptCount).toBe(2);
    expect(attempt.outcome.passed).toBe(false);
  });
});
