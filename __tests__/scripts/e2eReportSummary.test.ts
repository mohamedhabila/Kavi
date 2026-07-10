import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const { projectPublicRunReport } = require('../../scripts/e2eReport/publicRunReport');
const {
  buildE2eReportSummaryMarkdown,
  resolveSummaryPath,
  writeE2eReportSummaryArtifact,
} = require('../../scripts/e2eReport/summary');

function createReport() {
  return projectPublicRunReport({
    schemaVersion: 'e2e-run-report-v2',
    generatedAt: '2026-06-20T10:00:00.000Z',
    maxScenarioRetries: 1,
    runMetadata: {
      gitSha: 'abcdef1234567890',
      provider: 'gemini',
      hostedFamily: 'gemini',
      model: 'gemini-test',
      modelIdentitySource: 'provider-model-id',
      modelLocatorSha256: 'b'.repeat(64),
      endpointSha256: 'a'.repeat(64),
      scenarioManifestVersion: '2026-07-10.longitudinal-v2',
      promptCacheMode: 'provider-default',
      nativeToolFixtureVersion: 'native-tools-2026-07-10',
      collectMode: false,
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
      generatedAt: '2026-06-20T10:00:00.000Z',
      evidenceScore: 0.75,
      dimensions: [],
      benchmarkFamilies: [],
      dimensionsPassing: true,
      benchmarkFamiliesPassing: true,
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
      failedCriteria: ['critical_dimension_failures'],
    },
    readinessDashboard: {
      tokenCostLatency: {
        estimatedCostUsd: null,
        costStatus: 'provider_pricing_not_configured',
        pricingSnapshot: null,
      },
    },
    metricsPassing: false,
    scenarios: [
      {
        suite: 'core',
        fixtureId: 'core-pass',
        contentClass: 'synthetic_public',
        passed: true,
        attemptCount: 1,
        durationMs: 900,
        toolCallCount: 2,
        graphStatus: 'finalized',
        usage: {
          totalTokens: 40,
          cacheReadTokens: 5,
        },
        errorCount: 0,
      },
      {
        suite: 'core',
        fixtureId: 'core-fail',
        contentClass: 'synthetic_public',
        passed: false,
        attemptCount: 2,
        durationMs: 1500,
        toolCallCount: 3,
        graphStatus: 'failed',
        usage: {
          totalTokens: 110,
          cacheReadTokens: 20,
        },
        errors: ['raw provider error'],
        failedRubrics: [{ fixtureId: 'criterion', detail: 'raw rubric detail secret-value' }],
        loopDiagnostics: {
          passing: false,
          repeatedToolCalls: [{ name: 'read_file', argsHash: 'hash', count: 2 }],
        },
      },
    ],
  });
}

describe('e2e report summary', () => {
  it('builds a sanitized Markdown summary without raw error details', () => {
    const markdown = buildE2eReportSummaryMarkdown(createReport());

    expect(markdown).toContain('# E2E Agent Report Summary');
    expect(markdown).toContain('Scenarios: 1/2 passed (50.0%)');
    expect(markdown).toContain('core-fail');
    expect(markdown).toContain('critical_dimension_failures');
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

  it('rejects malformed or private values instead of publishing them into Markdown', () => {
    const report = createReport();
    const cases = [
      ['provider', (candidate: any) => (candidate.runMetadata.provider = 'PRIVATE_PROVIDER_SENTINEL')],
      ['model', (candidate: any) => (candidate.runMetadata.model = '/private/model/sentinel')],
      ['fixture', (candidate: any) => (candidate.scenarios[0].fixtureId = '/private/fixture')],
      [
        'criterion',
        (candidate: any) =>
          (candidate.readiness.failedCriteria = ['PRIVATE_CRITERION_SENTINEL']),
      ],
      ['content class', (candidate: any) => (candidate.scenarios[0].contentClass = 'private-ish')],
      ['unknown field', (candidate: any) => (candidate.privatePayload = 'PRIVATE_SENTINEL')],
    ] as const;

    for (const [label, mutate] of cases) {
      const candidate = structuredClone(report);
      mutate(candidate);
      expect(() => buildE2eReportSummaryMarkdown(candidate)).toThrow();
      expect(label).toBeTruthy();
    }

    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-summary-private-'));
    const reportPath = join(dir, 'e2e-agent-report.json');
    const candidate = structuredClone(report);
    candidate.runMetadata.model = '/private/model/sentinel';
    try {
      expect(() => writeE2eReportSummaryArtifact(reportPath, candidate, {})).toThrow();
      expect(existsSync(join(dir, 'e2e-agent-report.md'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails the summary CLI before writing output for a discriminator-only report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-summary-invalid-'));
    const reportPath = join(dir, 'e2e-agent-report.json');
    const summaryPath = join(dir, 'e2e-agent-report.md');
    writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 'e2e-run-report-v2',
        runMetadata: {
          provider: 'PRIVATE_PROVIDER_SENTINEL',
          model: '/private/model/sentinel',
        },
      }),
      'utf8',
    );

    try {
      const result = spawnSync('node', ['./scripts/e2e-report-summary.js', reportPath], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
      expect(existsSync(summaryPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
