import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { isAbsolute, join } from 'path';
import { tmpdir } from 'os';

import {
  buildE2ERunReport,
  buildE2ERunReportScenarioEntry,
  digestE2EProviderEndpoint,
  flushE2ERunReport,
  recordE2ERunReportEntry,
  writeE2EReadinessDashboardArtifacts,
} from '../../src/acceptance/e2eAgent/e2eRunReport';
import { E2E_SCENARIO_MANIFEST_VERSION } from '../../src/acceptance/e2eAgent/thresholds';

import {
  buildFixtureResult,
  installE2ERunReportFixtureReset,
} from '../helpers/e2eRunReportHarness';

describe('e2eRunReport artifacts', () => {
  installE2ERunReportFixtureReset();

  it('recordE2ERunReportEntry and flushE2ERunReport write JSON artifact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-private-sentinel-'));
    const reportPath = join(dir, 'e2e-agent-report.json');
    const env = {
      E2E_REPORT_PATH: reportPath,
      E2E_MAX_SCENARIO_RETRIES: '1',
      GEMINI_BASE_URL: 'https://private-sentinel.invalid/local-endpoint',
    };
    const retentionDir = join(dir, 'e2e-readiness-runs');
    const legacyRunDir = join(retentionDir, 'legacy-run');
    mkdirSync(legacyRunDir, { recursive: true });
    writeFileSync(join(legacyRunDir, 'report.json'), 'private-sentinel-legacy-report', 'utf8');
    writeFileSync(
      join(retentionDir, 'index.json'),
      JSON.stringify({
        version: '2026-06-12.phase8',
        runs: [
          {
            runId: 'legacy-run',
            reportPath: join(legacyRunDir, 'report.json'),
            dashboardPath: join(legacyRunDir, 'dashboard.json'),
          },
        ],
      }),
      'utf8',
    );

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
        schemaVersion: string;
        scenarios: Array<{
          fixtureId: string;
          trace?: unknown;
          traceArtifact?: {
            referenceBase: string;
            relativePath: string;
            retentionReason: string;
          };
        }>;
        runMetadata: {
          hostedFamily: string;
          model: string;
          endpointSha256: string;
          scenarioManifestVersion: string;
        };
        reliability: { pass1PassedCount: number; passKPassedCount: number };
        cache: { passing: boolean };
        graderAudit: { passing: boolean };
        readiness: { passing: boolean };
        readinessDashboard: {
          overall: { passing: boolean };
          benchmarkRequirements: { externalRequired: number };
        };
      };
      expect(persisted.schemaVersion).toBe('e2e-run-report-v2');
      expect(persisted.scenarios[0]?.fixtureId).toBe('file-write-read');
      const persistedPass = persisted.scenarios.find(
        (scenario) => scenario.fixtureId === 'file-write-read',
      );
      const persistedFailure = persisted.scenarios.find(
        (scenario) => scenario.fixtureId === 'goal-evidence-complete',
      );
      expect(persistedPass?.traceArtifact).toMatchObject({
        referenceBase: 'retention_root',
        retentionReason: 'sampled_pass',
      });
      expect(persistedFailure?.traceArtifact).toMatchObject({
        referenceBase: 'retention_root',
        retentionReason: 'failed',
      });
      expect(persistedPass?.traceArtifact?.relativePath).toMatch(
        /^run-[^/]+\/redacted-traces\/sampled_pass-file-write-read-[a-f0-9]{12}\.json$/u,
      );
      expect(persistedFailure?.traceArtifact?.relativePath).toMatch(
        /^run-[^/]+\/redacted-traces\/failed-goal-evidence-complete-[a-f0-9]{12}\.json$/u,
      );
      expect(persistedPass?.trace).toBeUndefined();
      expect(persistedFailure?.trace).toBeUndefined();
      expect(isAbsolute(persistedPass!.traceArtifact!.relativePath)).toBe(false);
      expect(isAbsolute(persistedFailure!.traceArtifact!.relativePath)).toBe(false);
      expect(persisted.runMetadata.hostedFamily).toBe('gemini');
      expect(persisted.runMetadata.model).toBeTruthy();
      expect(persisted.runMetadata.endpointSha256).toBe(
        digestE2EProviderEndpoint('https://private-sentinel.invalid/local-endpoint'),
      );
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
      expect(existsSync(legacyRunDir)).toBe(false);
      const retentionIndex = JSON.parse(readFileSync(retentionIndexPath, 'utf8')) as {
        retainedRunCount: number;
        runs: Array<{
          runId: string;
          dashboardRelativePath: string;
          reportRelativePath: string;
        }>;
      };
      expect(retentionIndex.retainedRunCount).toBe(1);
      const retainedRun = retentionIndex.runs[0]!;
      expect(isAbsolute(retainedRun.dashboardRelativePath)).toBe(false);
      expect(isAbsolute(retainedRun.reportRelativePath)).toBe(false);
      expect(retainedRun.dashboardRelativePath).toBe(`${retainedRun.runId}/dashboard.json`);
      expect(retainedRun.reportRelativePath).toBe(`${retainedRun.runId}/report.json`);
      expect(existsSync(join(dir, 'e2e-readiness-runs', retainedRun.dashboardRelativePath))).toBe(
        true,
      );
      expect(existsSync(join(dir, 'e2e-readiness-runs', retainedRun.reportRelativePath))).toBe(
        true,
      );

      const retentionDir = join(dir, 'e2e-readiness-runs');
      const runDir = join(retentionDir, retainedRun.runId);
      const failedTracePath = join(retentionDir, persistedFailure!.traceArtifact!.relativePath);
      const passTracePath = join(retentionDir, persistedPass!.traceArtifact!.relativePath);
      expect(existsSync(passTracePath)).toBe(true);
      expect(existsSync(failedTracePath)).toBe(true);
      const failedTrace = readFileSync(failedTracePath, 'utf8');
      expect(failedTrace).toContain('goal-evidence-complete');
      expect(failedTrace).toContain('"toolCatalogResult"');
      expect(failedTrace).toContain('"memory_recall"');
      expect(failedTrace).toContain('"totalMatches": 1');
      expect(failedTrace).not.toContain('SECRET-TRACE-ARG');
      expect(failedTrace).not.toContain('SECRET-TRACE-RESULT');
      const traceIndexPath = join(runDir, 'redacted-traces', 'index.json');
      expect(existsSync(traceIndexPath)).toBe(true);

      const publicJson = [
        readFileSync(reportPath, 'utf8'),
        readFileSync(dashboardPath, 'utf8'),
        readFileSync(retentionIndexPath, 'utf8'),
        readFileSync(join(dir, 'e2e-readiness-runs', retainedRun.reportRelativePath), 'utf8'),
        readFileSync(join(dir, 'e2e-readiness-runs', retainedRun.dashboardRelativePath), 'utf8'),
        readFileSync(traceIndexPath, 'utf8'),
        readFileSync(passTracePath, 'utf8'),
        failedTrace,
      ].join('\n');
      expect(publicJson).not.toContain(dir);
      expect(publicJson).not.toContain('private-sentinel');
      expect(publicJson).not.toContain('local-endpoint');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('atomically replaces a colliding run and keeps slug-colliding traces distinct', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-run-replace-'));
    const reportPath = join(dir, 'e2e-agent-report.json');
    const retentionDir = join(dir, 'e2e-readiness-runs');
    const entries = ['slug/a', 'slug a'].map((fixtureId) =>
      buildE2ERunReportScenarioEntry({
        suite: 'core',
        result: buildFixtureResult({ fixtureId }),
        outcome: { fixtureId, passed: false, detail: 'intentional failure' },
        attemptCount: 1,
      }),
    );
    const report = buildE2ERunReport(entries, {
      generatedAt: '2026-07-10T12:00:00.000Z',
      runMetadata: {
        providerKey: 'gemini',
        gitSha: 'a'.repeat(40),
        modelLocator: 'gemini-3.5-flash',
        providerEndpoint: 'https://aiplatform.googleapis.com/v1',
      },
    });

    try {
      const first = writeE2EReadinessDashboardArtifacts(reportPath, report, {
        E2E_READINESS_ARTIFACT_RETENTION_DIR: retentionDir,
      });
      writeFileSync(join(first.runDir, 'stale-private.json'), 'private', 'utf8');

      const second = writeE2EReadinessDashboardArtifacts(reportPath, report, {
        E2E_READINESS_ARTIFACT_RETENTION_DIR: retentionDir,
      });
      const tracePaths = second.report.scenarios
        .map((scenario) => scenario.traceArtifact?.relativePath)
        .filter((path): path is string => Boolean(path));

      expect(second.runDir).toBe(first.runDir);
      expect(existsSync(join(second.runDir, 'stale-private.json'))).toBe(false);
      expect(new Set(tracePaths).size).toBe(2);
      expect(tracePaths).toHaveLength(2);
      for (const tracePath of tracePaths) {
        expect(tracePath).toMatch(
          /^run-[^/]+\/redacted-traces\/failed-slug-a-[a-f0-9]{12}\.json$/u,
        );
        expect(existsSync(join(retentionDir, tracePath))).toBe(true);
      }
      expect(readdirSync(retentionDir).filter((entry) => entry.startsWith('.run-'))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails before mutating retained runs when the current index is corrupt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-corrupt-index-'));
    const retentionDir = join(dir, 'e2e-readiness-runs');
    const markerPath = join(retentionDir, 'existing-marker.txt');
    mkdirSync(retentionDir, { recursive: true });
    writeFileSync(join(retentionDir, 'index.json'), '{not-json', 'utf8');
    writeFileSync(markerPath, 'unchanged', 'utf8');
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result: buildFixtureResult(),
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });
    const report = buildE2ERunReport([entry], {
      generatedAt: '2026-07-10T13:00:00.000Z',
      runMetadata: {
        providerKey: 'gemini',
        gitSha: 'b'.repeat(40),
        modelLocator: 'gemini-3.5-flash',
        providerEndpoint: 'https://aiplatform.googleapis.com/v1',
      },
    });

    try {
      expect(() =>
        writeE2EReadinessDashboardArtifacts(join(dir, 'report.json'), report, {
          E2E_READINESS_ARTIFACT_RETENTION_DIR: retentionDir,
        }),
      ).toThrow();
      expect(readFileSync(markerPath, 'utf8')).toBe('unchanged');
      expect(readdirSync(retentionDir).sort()).toEqual(['existing-marker.txt', 'index.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
