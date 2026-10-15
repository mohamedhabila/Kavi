// ---------------------------------------------------------------------------
// E2E phone-world slice — live provider (opt-in, RUN_E2E_AGENT_EVAL=1)
// ---------------------------------------------------------------------------
// Every task runs and is recorded; the slice then reports its pass rate against the
// frontier bar. Runs E2E_PHONE_WORLD_REPEATS times (default 1) to measure pass^k.

// The seeded calendar is in UTC; the device clock reads it the same way.
process.env.TZ = 'UTC';

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});

import {
  buildE2ERunReportScenarioEntry,
  recordE2ERunReportEntry,
} from '../../src/acceptance/e2eAgent/e2eRunReport';
import { runE2EScenarioWithRetry } from '../../src/acceptance/e2eAgent/e2eScenarioRetry';
import { shouldRunE2EAgentEval } from '../../src/acceptance/e2eAgent/providerConfig';
import {
  resetE2EMemorySandbox,
  teardownE2EMemorySandbox,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import { resetE2EWorkspaceSandbox } from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import { filterE2EScenarioSuiteEntries } from '../../src/acceptance/e2eAgent/scenarioSelection';
import { PHONE_WORLD_E2E_SCENARIOS } from '../../src/acceptance/e2eAgent/scenariosPhoneWorld';
import {
  E2E_PHONE_WORLD_MIN_PASS_RATE,
  E2E_PHONE_WORLD_PROGRAM_MAX_TOTAL_TOKENS,
} from '../../src/acceptance/e2eAgent/thresholds';

const describeE2E = shouldRunE2EAgentEval() ? describe : describe.skip;

const SELECTED = filterE2EScenarioSuiteEntries(
  PHONE_WORLD_E2E_SCENARIOS.map((scenario) => ({ suite: 'phone-world', scenario })),
  process.env.E2E_SCENARIO_IDS,
);
const REPEATS = Math.max(1, Number.parseInt(process.env.E2E_PHONE_WORLD_REPEATS ?? '1', 10) || 1);

describeE2E('E2E phone-world slice — selected provider', () => {
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

  const runs: Array<{ id: string; repeat: number; passed: boolean; totalTokens: number }> = [];

  for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
    for (const { scenario } of SELECTED) {
      it(`runs ${scenario.id} (run ${repeat})`, async () => {
        const attempt = await runE2EScenarioWithRetry(scenario);
        runs.push({
          id: scenario.id,
          repeat,
          passed: attempt.outcome.passed,
          totalTokens: attempt.result.usage.totalTokens,
        });
        recordE2ERunReportEntry(
          buildE2ERunReportScenarioEntry({
            suite: 'phone-world',
            result: attempt.result,
            outcome: attempt.outcome,
            attemptCount: attempt.attemptCount,
            rubrics: scenario.rubrics,
          }),
        );
        if (!attempt.outcome.passed) {
          console.error(
            `[e2e-phone-world] ${scenario.id} run ${repeat} failed`,
            attempt.outcome.detail,
            `tools=${attempt.result.toolCalls.map((call) => call.name).join(',')}`,
            `tokens=${attempt.result.usage.totalTokens}`,
          );
        }
        expect(attempt.result.userTurnCount).toBeGreaterThan(0);
      });
    }
  }

  it('clears the frontier bar', () => {
    expect(runs).toHaveLength(SELECTED.length * REPEATS);
    const passRate = runs.filter((run) => run.passed).length / runs.length;
    const passedEveryRun = SELECTED.filter(({ scenario }) =>
      runs.every((run) => run.id !== scenario.id || run.passed),
    ).length;
    const tokensPerPass =
      runs.reduce((sum, run) => sum + run.totalTokens, 0) / Math.max(1, REPEATS);
    console.log(
      `[e2e-phone-world] pass rate ${(passRate * 100).toFixed(1)}% over ${runs.length} runs; ` +
        `${passedEveryRun}/${SELECTED.length} tasks passed every run; ` +
        `${Math.round(tokensPerPass)} tokens per pass`,
    );

    expect(passRate).toBeGreaterThanOrEqual(E2E_PHONE_WORLD_MIN_PASS_RATE);
    expect(tokensPerPass).toBeLessThanOrEqual(E2E_PHONE_WORLD_PROGRAM_MAX_TOTAL_TOKENS);
  });
});
