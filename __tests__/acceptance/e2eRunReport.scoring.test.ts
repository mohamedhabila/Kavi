import {
  buildE2ERunReport,
  buildE2ERunReportScenarioEntry,
  formatE2ERunReportSummary,
} from '../../src/acceptance/e2eAgent/e2eRunReport';
import { E2E_SCENARIO_MANIFEST_VERSION } from '../../src/acceptance/e2eAgent/thresholds';

import {
  buildFixtureResult,
  installE2ERunReportFixtureReset,
} from '../helpers/e2eRunReportHarness';

describe('e2eRunReport scoring and reliability', () => {
  installE2ERunReportFixtureReset();

  it('buildE2ERunReport aggregates totals and pass counts', () => {
    const passEntry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result: buildFixtureResult(),
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });
    const failEntry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result: buildFixtureResult({
        fixtureId: 'goal-evidence-complete',
        usage: {
          inputTokens: 50,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 60,
          eventCount: 1,
        },
      }),
      outcome: {
        fixtureId: 'goal-evidence-complete',
        passed: false,
        detail: 'tool write_file called 0 times',
      },
      attemptCount: 2,
    });

    const report = buildE2ERunReport([passEntry, failEntry], {
      generatedAt: '2026-06-10T00:00:00.000Z',
      maxScenarioRetries: 1,
      runMetadata: {
        gitSha: 'test-sha',
        model: 'gemini-3.5-flash',
        providerBaseUrl: 'https://aiplatform.googleapis.com/v1',
        collectMode: true,
      },
    });

    expect(report.totals).toMatchObject({
      scenarioCount: 2,
      passedCount: 1,
      failedCount: 1,
      inputTokens: 150,
      outputTokens: 30,
      totalTokens: 185,
      durationMs: 2400,
    });
    expect(report.maxScenarioRetries).toBe(1);
    expect(report.runMetadata).toMatchObject({
      gitSha: 'test-sha',
      model: 'gemini-3.5-flash',
      collectMode: true,
      scenarioManifestVersion: E2E_SCENARIO_MANIFEST_VERSION,
    });
    expect(report.cache).toMatchObject({
      inputTokens: 150,
      eligibleInputTokens: 0,
      passing: false,
      promptCacheTelemetry: {
        eligibleTurnCount: 0,
        enabledTurnCount: 0,
        skippedTurnCount: 0,
        createEventCount: 0,
        reuseEventCount: 0,
        providerManagedEventCount: 0,
        thresholdTokens: [],
        explicitCacheNameCount: 0,
        reasonCounts: [],
      },
    });
    expect(report.graderAudit).toMatchObject({
      scenarioCount: 2,
      assistantProseRubricCount: 0,
      weakPatternRubricCount: 0,
      passing: true,
    });
    expect(report.reliability).toMatchObject({
      k: 2,
      scenarioCount: 2,
      pass1PassedCount: 1,
      passKPassedCount: 1,
      retriedScenarioCount: 1,
    });
    expect(report.readiness.passing).toBe(false);
    expect(report.readiness.failedCriteria).toContain('scenario_pass_rate');
    expect(report.readiness.failedCriteria).toContain('pass1_reliability');
    expect(report.assessment.scenarioCount).toBe(2);
    expect(report.assessment.overallScenarioPassRate).toBe(0.5);
    expect(formatE2ERunReportSummary(report)).toContain('scenarios=1/2 passed');
    expect(formatE2ERunReportSummary(report)).toContain('reliability pass1=1/2 pass^2=1/2');
    expect(formatE2ERunReportSummary(report)).toContain('readiness=false');
    expect(formatE2ERunReportSummary(report)).toContain('assessment evidenceScore=');
  });

  it('keeps pass^1 reliability separate from retry-assisted pass^k', () => {
    const retriedPassEntry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result: buildFixtureResult(),
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 2,
    });

    const report = buildE2ERunReport([retriedPassEntry], {
      maxScenarioRetries: 2,
      cacheTelemetry: {
        cacheCreateAttempts: 0,
        cacheCreateFailureCount: 0,
        cacheCreateFailuresByProviderStatus: [],
        cacheCreateTelemetryAvailable: true,
      },
    });

    expect(report.reliability).toMatchObject({
      k: 3,
      scenarioCount: 1,
      pass1PassedCount: 0,
      passKPassedCount: 1,
      pass1Rate: 0,
      passKRate: 1,
      retriedScenarioCount: 1,
    });
    expect(report.readiness.failedCriteria).toContain('pass1_reliability');
    expect(report.readiness.failedCriteria).not.toContain('scenario_pass_rate');
  });

  it('reports provider cache-create failures without deriving them from scenario outcomes', () => {
    const result = buildFixtureResult();
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });

    const report = buildE2ERunReport([entry], {
      cacheTelemetry: {
        cacheCreateAttempts: 3,
        cacheCreateFailureCount: 2,
        cacheCreateFailuresByProviderStatus: [
          { providerStatus: '400', count: 1 },
          { providerStatus: 'network_error', count: 1 },
        ],
        cacheCreateTelemetryAvailable: true,
      },
    });

    expect(report.cache).toMatchObject({
      cacheCreateAttempts: 3,
      cacheCreateFailureCount: 2,
      cacheCreateFailuresByProviderStatus: [
        { providerStatus: '400', count: 1 },
        { providerStatus: 'network_error', count: 1 },
      ],
      cacheCreateTelemetryAvailable: true,
    });
  });
});
