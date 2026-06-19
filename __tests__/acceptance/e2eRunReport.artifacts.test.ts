import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

import {
  buildE2ERunReportScenarioEntry,
  flushE2ERunReport,
  recordE2ERunReportEntry,
} from '../../src/acceptance/e2eAgent/e2eRunReport';
import { E2E_SCENARIO_MANIFEST_VERSION } from '../../src/acceptance/e2eAgent/thresholds';

import {
  buildFixtureResult,
  installE2ERunReportFixtureReset,
} from '../helpers/e2eRunReportHarness';

describe('e2eRunReport artifacts', () => {
  installE2ERunReportFixtureReset();

  it('recordE2ERunReportEntry and flushE2ERunReport write JSON artifact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-report-'));
    const reportPath = join(dir, 'e2e-agent-report.json');
    const env = {
      E2E_REPORT_PATH: reportPath,
      E2E_MAX_SCENARIO_RETRIES: '1',
    };

    try {
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
          toolCalls: [
            {
              id: 'tc-catalog',
              name: 'tool_catalog',
              arguments: '{"query":"SECRET-TRACE-ARG","category":"memory"}',
            },
            {
              id: 'tc-private',
              name: 'write_file',
              arguments: '{"path":"artifacts/private.txt","content":"SECRET-TRACE-ARG"}',
            },
          ],
          toolResults: [
            {
              toolCallId: 'tc-catalog',
              name: 'tool_catalog',
              content: JSON.stringify({
                mode: 'search',
                category: 'memory',
                query: 'SECRET-TRACE-RESULT',
                tools: [
                  {
                    name: 'memory_recall',
                    activation: { name: 'memory_recall', eligible: true },
                  },
                ],
                totalMatches: 1,
              }),
              isError: false,
            },
            {
              toolCallId: 'tc-private',
              name: 'write_file',
              content: '{"status":"failed","secret":"SECRET-TRACE-RESULT"}',
              isError: true,
            },
          ],
        }),
        outcome: {
          fixtureId: 'goal-evidence-complete',
          passed: false,
          detail: 'workspace artifact missing',
        },
        attemptCount: 1,
        rubrics: [
          {
            kind: 'workspace_file',
            path: 'artifacts/private.txt',
            contains: 'SECRET-TRACE-RESULT',
          },
        ],
      });

      recordE2ERunReportEntry(passEntry, env);
      recordE2ERunReportEntry(failEntry, env);

      const report = flushE2ERunReport(env);
      expect(report).not.toBeNull();
      expect(report?.scenarios).toHaveLength(2);

      const persisted = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        scenarios: Array<{
          fixtureId: string;
          trace?: unknown;
          traceArtifact?: { path: string; retentionReason: string };
        }>;
        runMetadata: { model: string; scenarioManifestVersion: string };
        reliability: { pass1PassedCount: number; passKPassedCount: number };
        cache: { passing: boolean };
        graderAudit: { passing: boolean };
        readiness: { passing: boolean };
        readinessDashboard: {
          overall: { passing: boolean };
          benchmarkRequirements: { externalRequired: number };
        };
      };
      expect(persisted.scenarios[0]?.fixtureId).toBe('file-write-read');
      const persistedPass = persisted.scenarios.find(
        (scenario) => scenario.fixtureId === 'file-write-read',
      );
      const persistedFailure = persisted.scenarios.find(
        (scenario) => scenario.fixtureId === 'goal-evidence-complete',
      );
      expect(persistedPass?.traceArtifact).toMatchObject({
        retentionReason: 'sampled_pass',
      });
      expect(persistedFailure?.traceArtifact).toMatchObject({
        retentionReason: 'failed',
      });
      expect(persistedPass?.trace).toBeUndefined();
      expect(persistedFailure?.trace).toBeUndefined();
      expect(existsSync(persistedPass!.traceArtifact!.path)).toBe(true);
      expect(existsSync(persistedFailure!.traceArtifact!.path)).toBe(true);
      const failedTrace = readFileSync(persistedFailure!.traceArtifact!.path, 'utf8');
      expect(failedTrace).toContain('goal-evidence-complete');
      expect(failedTrace).toContain('"toolCatalogResult"');
      expect(failedTrace).toContain('"memory_recall"');
      expect(failedTrace).toContain('"totalMatches": 1');
      expect(failedTrace).not.toContain('SECRET-TRACE-ARG');
      expect(failedTrace).not.toContain('SECRET-TRACE-RESULT');
      expect(persisted.runMetadata.model).toBeTruthy();
      expect(persisted.runMetadata.scenarioManifestVersion).toBe(E2E_SCENARIO_MANIFEST_VERSION);
      expect(persisted.reliability).toMatchObject({
        pass1PassedCount: 1,
        passKPassedCount: 1,
      });
      expect(persisted.cache.passing).toBe(false);
      expect(persisted.graderAudit.passing).toBe(true);
      expect(persisted.readiness.passing).toBe(false);
      expect(persisted.readinessDashboard.overall.passing).toBe(false);

      const dashboardPath = `${reportPath}.dashboard.json`;
      expect(existsSync(dashboardPath)).toBe(true);
      const dashboard = JSON.parse(readFileSync(dashboardPath, 'utf8')) as {
        benchmarkRequirements: { externalRequired: number };
      };
      expect(dashboard.benchmarkRequirements.externalRequired).toBeGreaterThan(0);

      const retentionIndexPath = join(dir, 'e2e-readiness-runs', 'index.json');
      expect(existsSync(retentionIndexPath)).toBe(true);
      const retentionIndex = JSON.parse(readFileSync(retentionIndexPath, 'utf8')) as {
        retainedRunCount: number;
        runs: Array<{ dashboardPath: string; reportPath: string }>;
      };
      expect(retentionIndex.retainedRunCount).toBe(1);
      expect(existsSync(retentionIndex.runs[0]!.dashboardPath)).toBe(true);
      expect(existsSync(retentionIndex.runs[0]!.reportPath)).toBe(true);
      expect(existsSync(join(dirname(persistedFailure!.traceArtifact!.path), 'index.json'))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
