import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../..');

function runFlush(env: NodeJS.ProcessEnv) {
  return spawnSync('node', ['./scripts/e2e-flush-run-report.js'], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
  });
}

describe('e2e-flush-run-report harness', () => {
  it('writes final JSON report from partial entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-flush-'));
    const reportPath = join(dir, 'e2e-agent-report.json');
    const partialPath = `${reportPath}.partial.json`;

    writeFileSync(
      partialPath,
      JSON.stringify([
        {
          suite: 'core',
          fixtureId: 'file-write-read',
          passed: true,
          attemptCount: 1,
          durationMs: 1000,
          completed: true,
          userTurnCount: 1,
          toolCallCount: 2,
          graphStatus: 'finalized',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 15,
            tokenBuckets: {
              systemPromptTokens: 1,
              toolDeclarationTokens: 2,
              memoryContextTokens: 3,
              conversationHistoryTokens: 4,
              userTurnTokens: 5,
              toolResultTokens: 6,
            },
            promptCache: {
              eligibleTurnCount: 1,
              enabledTurnCount: 1,
              skippedTurnCount: 0,
              createEventCount: 0,
              reuseEventCount: 0,
              providerManagedEventCount: 1,
              thresholdTokens: [1024],
              explicitCacheNames: ['cm:test'],
              reasonCounts: [{ reason: 'automatic_prompt_cache', count: 1 }],
              events: [
                {
                  eligible: true,
                  enabled: true,
                  estimatedInputTokens: 1024,
                  thresholdTokens: 1024,
                  providerFamily: 'openai',
                  hostedFamily: 'openai',
                  mode: 'openai_native',
                  event: 'provider_managed',
                  reason: 'automatic_prompt_cache',
                  explicitCacheName: 'cm:test',
                },
              ],
            },
          },
          errors: [],
        },
      ]),
      'utf8',
    );

    try {
      const result = runFlush({
        ...process.env,
        E2E_REPORT_PATH: reportPath,
        E2E_MAX_SCENARIO_RETRIES: '1',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('wrote');

      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        scenarios: Array<{
          fixtureId: string;
          tokenBuckets: {
            toolDeclarationTokens: number;
          };
          promptCache?: {
            eligibleTurnCount: number;
          };
        }>;
        totals: { scenarioCount: number };
        maxScenarioRetries: number;
        runMetadata: { model: string; scenarioManifestVersion: string };
        reliability: {
          k: number;
          pass1PassedCount: number;
          passKPassedCount: number;
          retriedScenarioCount: number;
        };
        cache: {
          eligibleInputThreshold: number;
          passing: boolean;
          promptCacheTelemetry: {
            eligibleTurnCount: number;
            providerManagedEventCount: number;
            explicitCacheNameCount: number;
          };
        };
        graderAudit: { passing: boolean };
        readiness: { passing: boolean };
        readinessDashboard: {
          version: string;
          overall: { passing: boolean };
          failureTaxonomy: Array<{
            category: string;
            externalRequirementIds: string[];
          }>;
          artifactRetention: { defaultRetainedRuns: number };
        };
      };
      expect(report.scenarios[0]?.fixtureId).toBe('file-write-read');
      expect(report.scenarios[0]?.tokenBuckets.toolDeclarationTokens).toBe(2);
      expect(report.scenarios[0]?.promptCache?.eligibleTurnCount).toBe(1);
      expect(report.totals.scenarioCount).toBe(1);
      expect(report.maxScenarioRetries).toBe(1);
      expect(report.runMetadata.model).toBe('gemini-3.5-flash');
      expect(report.runMetadata.scenarioManifestVersion).toBe('2026-06-12.phase0');
      expect(report.reliability).toMatchObject({
        k: 2,
        pass1PassedCount: 1,
        passKPassedCount: 1,
        retriedScenarioCount: 0,
      });
      expect(report.cache.eligibleInputThreshold).toBe(4096);
      expect(report.cache.promptCacheTelemetry).toMatchObject({
        eligibleTurnCount: 1,
        providerManagedEventCount: 1,
        explicitCacheNameCount: 1,
      });
      expect(report.cache.passing).toBe(false);
      expect(report.graderAudit.passing).toBe(true);
      expect(report.readiness.passing).toBe(false);
      expect(report.readinessDashboard).toMatchObject({
        version: '2026-06-12.phase8',
        overall: { passing: false },
        artifactRetention: { defaultRetainedRuns: 90 },
      });
      expect(report.readinessDashboard.failureTaxonomy).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'external_runner_required',
            externalRequirementIds: expect.arrayContaining([
              'androidworld-device-runner',
              'agentdojo-prompt-injection',
            ]),
          }),
        ]),
      );

      const dashboardPath = `${reportPath}.dashboard.json`;
      expect(existsSync(dashboardPath)).toBe(true);
      const dashboard = JSON.parse(readFileSync(dashboardPath, 'utf8')) as {
        benchmarkRequirements: { externalRequired: number };
      };
      expect(dashboard.benchmarkRequirements.externalRequired).toBeGreaterThan(0);

      const retentionIndex = JSON.parse(
        readFileSync(join(dir, 'e2e-readiness-runs', 'index.json'), 'utf8'),
      ) as { retainedRunCount: number; runs: Array<{ dashboardPath: string }> };
      expect(retentionIndex.retainedRunCount).toBe(1);
      expect(existsSync(retentionIndex.runs[0]!.dashboardPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no-ops when E2E_REPORT_PATH is unset', () => {
    const result = runFlush({
      ...process.env,
      E2E_REPORT_PATH: '',
    });

    expect(result.status).toBe(0);
  });

  it('reports retry-assisted pass^k separately from pass^1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-flush-reliability-'));
    const reportPath = join(dir, 'e2e-agent-report.json');
    const partialPath = `${reportPath}.partial.json`;

    writeFileSync(
      partialPath,
      JSON.stringify([
        {
          suite: 'core',
          fixtureId: 'file-write-read',
          passed: true,
          attemptCount: 2,
          durationMs: 1000,
          completed: true,
          userTurnCount: 1,
          toolCallCount: 1,
          graphStatus: 'finalized',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 15,
          },
          benchmarkFamilies: ['kavi-core'],
          assessmentDimensions: ['task_completion'],
          errors: [],
        },
      ]),
      'utf8',
    );

    try {
      const result = runFlush({
        ...process.env,
        E2E_REPORT_PATH: reportPath,
        E2E_MAX_SCENARIO_RETRIES: '2',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('reliability pass1=0/1 pass^3=1/1');

      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        reliability: {
          k: number;
          pass1Rate: number;
          passKRate: number;
          retriedScenarioCount: number;
        };
        readiness: { failedCriteria: string[] };
      };
      expect(report.reliability).toMatchObject({
        k: 3,
        pass1Rate: 0,
        passKRate: 1,
        retriedScenarioCount: 1,
      });
      expect(report.readiness.failedCriteria).toContain('pass1_reliability');
      expect(report.readiness.failedCriteria).not.toContain('scenario_pass_rate');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('threads explicit cache-create telemetry into the final report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-flush-cache-'));
    const reportPath = join(dir, 'e2e-agent-report.json');
    const partialPath = `${reportPath}.partial.json`;

    writeFileSync(
      partialPath,
      JSON.stringify([
        {
          suite: 'core',
          fixtureId: 'cache-readiness',
          passed: true,
          attemptCount: 1,
          durationMs: 1000,
          completed: true,
          userTurnCount: 1,
          toolCallCount: 1,
          graphStatus: 'finalized',
          usage: {
            inputTokens: 4096,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 4101,
          },
          errors: [],
        },
      ]),
      'utf8',
    );

    try {
      const result = runFlush({
        ...process.env,
        E2E_REPORT_PATH: reportPath,
        E2E_CACHE_CREATE_ATTEMPTS: '2',
        E2E_CACHE_CREATE_FAILURE_COUNT: '1',
        E2E_CACHE_CREATE_FAILURES_JSON: JSON.stringify([{ providerStatus: '400', count: 1 }]),
      });

      expect(result.status).toBe(0);

      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        cache: {
          cacheCreateAttempts: number;
          cacheCreateFailureCount: number;
          cacheCreateFailuresByProviderStatus: Array<{ providerStatus: string; count: number }>;
          cacheCreateTelemetryAvailable: boolean;
        };
        readiness: { failedCriteria: string[] };
      };
      expect(report.cache).toMatchObject({
        cacheCreateAttempts: 2,
        cacheCreateFailureCount: 1,
        cacheCreateFailuresByProviderStatus: [{ providerStatus: '400', count: 1 }],
        cacheCreateTelemetryAvailable: true,
      });
      expect(report.readiness.failedCriteria).toContain('cache_readiness');
      expect(report.readiness.failedCriteria).not.toContain('cache_create_telemetry');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
