// ---------------------------------------------------------------------------
// E2E assessment collect — run full suite, always emit evidence report
// ---------------------------------------------------------------------------
// Unlike e2eAgentMetrics.test.ts, individual scenario failures do not fail Jest.
// Use npm run eval:e2e:assess for evidence collection after report-format changes.
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

import { formatE2EAssessmentReportSummary } from '../../src/acceptance/e2eAgent/e2eAssessmentReport';
import { E2E_REPORT_PATH_ENV } from '../../src/acceptance/e2eAgent/e2eRunReport';
import {
  buildE2ERunReport,
  buildE2ERunReportScenarioEntry,
  flushE2ERunReport,
  formatE2ERunReportSummary,
  recordE2ERunReportEntry,
} from '../../src/acceptance/e2eAgent/e2eRunReport';
import { runE2EScenarioWithRetry } from '../../src/acceptance/e2eAgent/e2eScenarioRetry';
import {
  buildE2EProvider,
  shouldRunE2EAgentEval,
} from '../../src/acceptance/e2eAgent/providerConfig';
import {
  DELEGATION_E2E_SCENARIOS,
  E2E_AGENT_SCENARIOS,
} from '../../src/acceptance/e2eAgent/scenarios';
import { filterE2EScenarioSuiteEntries } from '../../src/acceptance/e2eAgent/scenarioSelection';
import {
  resetE2EMemorySandbox,
  teardownE2EMemorySandbox,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import { resetE2EWorkspaceSandbox } from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import type { AcceptanceFixtureOutcome } from '../../src/acceptance/acceptanceMetrics/types';
import type { E2EScenario, E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';

const describeE2E = shouldRunE2EAgentEval() ? describe : describe.skip;

const ALL_COLLECT_SCENARIOS: ReadonlyArray<{ suite: string; scenario: E2EScenario }> = [
  ...E2E_AGENT_SCENARIOS.map((scenario) => ({ suite: 'core', scenario })),
  ...DELEGATION_E2E_SCENARIOS.map((scenario) => ({ suite: 'delegation', scenario })),
];

const COLLECT_SCENARIOS = filterE2EScenarioSuiteEntries(
  ALL_COLLECT_SCENARIOS,
  process.env.E2E_SCENARIO_IDS,
);

describeE2E('E2E assessment collect — full suite evidence', () => {
  jest.setTimeout(3_600_000);

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

  it('runs all scenarios and emits dimensional assessment report', async () => {
    const provider = buildE2EProvider();
    const scenarioResults: E2EScenarioResult[] = [];
    const scenarioOutcomes: AcceptanceFixtureOutcome[] = [];
    const reportEntries: ReturnType<typeof buildE2ERunReportScenarioEntry>[] = [];

    for (const { suite, scenario } of COLLECT_SCENARIOS) {
      const attempt = await runE2EScenarioWithRetry(scenario);
      scenarioResults.push(attempt.result);
      scenarioOutcomes.push(attempt.outcome);

      const entry = buildE2ERunReportScenarioEntry({
        suite,
        result: attempt.result,
        outcome: attempt.outcome,
        attemptCount: attempt.attemptCount,
        rubrics: scenario.rubrics,
      });
      reportEntries.push(entry);
      recordE2ERunReportEntry(entry);

      if (!attempt.outcome.passed) {
        const lastGraph = attempt.result.graphSnapshots[attempt.result.graphSnapshots.length - 1];
        console.error(
          `[e2e-assessment-collect] ${scenario.id} failed`,
          attempt.outcome.detail,
          `attempts=${attempt.attemptCount}`,
          `rubrics=${entry.rubricPassed ?? '?'}/${entry.rubricTotal ?? '?'}`,
          `tools=${attempt.result.toolCalls.map((call) => call.name).join(',')}`,
          `graph=${lastGraph?.status ?? 'none'}`,
          `errors=${attempt.result.errors.join('|') || 'none'}`,
          `tokens=${attempt.result.usage.totalTokens}`,
        );
      }
    }

    const runReport = buildE2ERunReport(reportEntries, {
      metricOutcomes: scenarioOutcomes,
      metricResults: scenarioResults,
      runMetadata: {
        provider: provider.providerFamily ?? provider.name.toLowerCase(),
        providerId: provider.id,
        model: provider.model,
        providerBaseUrl: provider.baseUrl,
        collectMode: true,
      },
    });

    expect(runReport.scenarios).toHaveLength(COLLECT_SCENARIOS.length);
    expect(runReport.totals.scenarioCount).toBe(COLLECT_SCENARIOS.length);
    expect(runReport.runMetadata).toMatchObject({
      model: provider.model,
      collectMode: true,
    });

    const reportPath = process.env[E2E_REPORT_PATH_ENV]?.trim();
    if (reportPath) {
      const absoluteReportPath = resolve(reportPath);
      mkdirSync(dirname(absoluteReportPath), { recursive: true });
      writeFileSync(absoluteReportPath, JSON.stringify(runReport, null, 2), 'utf8');
    }

    const flushed = flushE2ERunReport();
    expect(flushed).not.toBeNull();
    expect(flushed!.scenarios).toHaveLength(COLLECT_SCENARIOS.length);

    console.log(formatE2ERunReportSummary(runReport));
    console.log(formatE2EAssessmentReportSummary(runReport.assessment));
    console.log(
      `[e2e-assessment-collect] passed=${runReport.totals.passedCount}/${runReport.totals.scenarioCount} evidenceScore=${runReport.assessment.evidenceScore.toFixed(3)}`,
    );
  });
});
