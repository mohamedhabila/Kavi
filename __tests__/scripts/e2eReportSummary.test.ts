import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const {
  buildE2eReportSummaryMarkdown,
  resolveSummaryPath,
  writeE2eReportSummaryArtifact,
} = require('../../scripts/e2eReport/summary');

function createReport() {
  return {
    generatedAt: '2026-06-20T10:00:00.000Z',
    maxScenarioRetries: 1,
    runMetadata: {
      gitSha: 'abcdef1234567890',
      provider: 'gemini',
      model: 'gemini-test',
      providerBaseUrl: 'https://example.invalid/private-endpoint',
      scenarioManifestVersion: '2026-06-12.phase0',
    },
    totals: {
      scenarioCount: 2,
      passedCount: 1,
      failedCount: 1,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 25,
      cacheWriteTokens: 10,
      totalTokens: 150,
      durationMs: 2400,
    },
    cache: {
      eligibleCacheReadRate: 0.5,
      targetEligibleCacheReadRate: 0.4,
      passing: true,
    },
    graderAudit: { passing: true },
    assessment: {
      evidenceScore: 0.75,
      dimensionsPassing: 8,
    },
    reliability: {
      k: 2,
      scenarioCount: 2,
      pass1PassedCount: 1,
      passKPassedCount: 2,
      retriedScenarioCount: 1,
    },
    readiness: {
      passing: false,
      failedCriteria: ['critical_failure_count'],
    },
    metricsPassing: false,
    scenarios: [
      {
        fixtureId: 'core-pass',
        passed: true,
        attemptCount: 1,
        durationMs: 900,
        toolCallCount: 2,
        graphStatus: 'finalized',
        usage: {
          totalTokens: 40,
          cacheReadTokens: 5,
        },
        errors: [],
      },
      {
        fixtureId: 'core-fail',
        passed: false,
        attemptCount: 2,
        durationMs: 1500,
        toolCallCount: 3,
        graphStatus: 'failed',
        usage: {
          totalTokens: 110,
          cacheReadTokens: 20,
        },
        errors: ['raw provider error with secret-value'],
        failedRubrics: [{ fixtureId: 'criterion', detail: 'raw rubric detail secret-value' }],
        loopDiagnostics: {
          passing: false,
          repeatedToolCalls: [{ name: 'read_file', argsHash: 'hash', count: 2 }],
        },
      },
    ],
  };
}

describe('e2e report summary', () => {
  it('builds a sanitized Markdown summary without raw error details', () => {
    const markdown = buildE2eReportSummaryMarkdown(createReport());

    expect(markdown).toContain('# E2E Agent Report Summary');
    expect(markdown).toContain('Scenarios: 1/2 passed (50.0%)');
    expect(markdown).toContain('core-fail');
    expect(markdown).toContain('critical_failure_count');
    expect(markdown).toContain('Sanitized artifact');
    expect(markdown).not.toContain('secret-value');
    expect(markdown).not.toContain('private-endpoint');
    expect(markdown).not.toContain('raw provider error');
    expect(markdown).not.toContain('raw rubric detail');
  });

  it('writes the default Markdown artifact next to the JSON report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-summary-'));
    const reportPath = join(dir, 'e2e-agent-report.json');

    try {
      const summaryPath = writeE2eReportSummaryArtifact(reportPath, createReport(), {});

      expect(summaryPath).toBe(join(dir, 'e2e-agent-report.md'));
      expect(resolveSummaryPath(reportPath, {})).toBe(summaryPath);
      expect(existsSync(summaryPath)).toBe(true);
      expect(readFileSync(summaryPath, 'utf8')).toContain('Provider: gemini');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
