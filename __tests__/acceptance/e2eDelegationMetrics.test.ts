// ---------------------------------------------------------------------------
// E2E delegation eval — live provider + live worker session (opt-in)
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  evaluateE2EAgentOutcomes,
  isE2EAgentMetricsPassing,
} from '../../src/acceptance/e2eAgent/evaluateE2EAgentMetrics';
import { shouldRunE2EAgentEval } from '../../src/acceptance/e2eAgent/providerConfig';
import {
  buildE2ERunReportScenarioEntry,
  recordE2ERunReportEntry,
} from '../../src/acceptance/e2eAgent/e2eRunReport';
import { runE2EScenarioWithRetry } from '../../src/acceptance/e2eAgent/e2eScenarioRetry';
import { DELEGATION_E2E_SCENARIOS } from '../../src/acceptance/e2eAgent/scenarios';
import { E2E_DELEGATION_PROGRAM_MAX_TOTAL_TOKENS } from '../../src/acceptance/e2eAgent/thresholds';
import {
  resetE2EMemorySandbox,
  teardownE2EMemorySandbox,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import { resetE2EWorkspaceSandbox } from '../../src/acceptance/e2eAgent/sandboxWorkspace';

const describeE2E = shouldRunE2EAgentEval() ? describe : describe.skip;

describeE2E('E2E delegation eval — selected provider', () => {
  jest.setTimeout(900_000);

  beforeEach(() => {
    resetE2EWorkspaceSandbox();
    resetE2EMemorySandbox();
  });

  afterEach(() => {
    resetE2EWorkspaceSandbox();
    teardownE2EMemorySandbox();
  });

  afterAll(() => {
    teardownE2EMemorySandbox();
  });

  const delegationOutcomes: Array<{
    outcome: Awaited<ReturnType<typeof runE2EScenarioWithRetry>>['outcome'];
    result: Awaited<ReturnType<typeof runE2EScenarioWithRetry>>['result'];
  }> = [];

  for (const scenario of DELEGATION_E2E_SCENARIOS) {
    it(`runs ${scenario.id} with structural rubrics`, async () => {
      const attempt = await runE2EScenarioWithRetry(scenario);
      delegationOutcomes.push({ outcome: attempt.outcome, result: attempt.result });
      recordE2ERunReportEntry(
        buildE2ERunReportScenarioEntry({
          suite: 'delegation',
          result: attempt.result,
          outcome: attempt.outcome,
          attemptCount: attempt.attemptCount,
          rubrics: scenario.rubrics,
        }),
      );

      if (!attempt.outcome.passed) {
        const lastGraph = attempt.result.graphSnapshots[attempt.result.graphSnapshots.length - 1];
        console.error(
          `[e2e-delegation-eval] ${scenario.id} failed`,
          attempt.outcome.detail,
          `attempts=${attempt.attemptCount}`,
          `tools=${attempt.result.toolCalls.map((call) => call.name).join(',')}`,
          `graph=${lastGraph?.status ?? 'none'}`,
          `evidence=${lastGraph?.goals?.map((goal) => `${goal.id}:${goal.evidence.length}`).join('|') ?? 'none'}`,
          `tokens=${attempt.result.usage.totalTokens}`,
        );
      }

      expect(attempt.outcome.passed).toBe(true);
      expect(attempt.result.usage.totalTokens).toBeLessThanOrEqual(
        E2E_DELEGATION_PROGRAM_MAX_TOTAL_TOKENS,
      );
    });
  }

  it('meets delegation program pass-rate threshold', () => {
    expect(delegationOutcomes.length).toBe(DELEGATION_E2E_SCENARIOS.length);
    const evaluation = evaluateE2EAgentOutcomes(
      delegationOutcomes.map((entry) => entry.outcome),
      delegationOutcomes.map((entry) => entry.result),
      { includeProgramCacheUtilization: false },
    );
    expect(isE2EAgentMetricsPassing(evaluation)).toBe(true);
  });
});
