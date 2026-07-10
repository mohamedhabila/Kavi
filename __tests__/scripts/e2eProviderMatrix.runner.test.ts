import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { runProviderBatchForMatrix } = require('../../scripts/e2eReport/providerMatrixRunner');

function createRun(reportPath: string) {
  return {
    providerKey: 'gemini',
    batchId: 'provider-core',
    scenarioIds: ['file-write-read'],
    reportPath,
  };
}

describe('provider matrix invocation isolation', () => {
  it('does not reuse a stale canonical report when the current process writes nothing', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'kavi-provider-matrix-stale-'));
    const reportPath = join(projectRoot, 'reports', 'gemini.json');
    const scriptPath = join(projectRoot, 'no-report.js');
    mkdirSync(join(projectRoot, 'reports'), { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify({ schemaVersion: 'e2e-run-report-v2', metricsPassing: true }),
      'utf8',
    );
    writeFileSync(scriptPath, 'process.exit(0);\n', 'utf8');

    try {
      const summary = runProviderBatchForMatrix({
        projectRoot,
        run: createRun(reportPath),
        assessmentScriptPath: scriptPath,
        env: {},
        stdio: 'pipe',
      });

      expect(summary).toMatchObject({
        status: 'failed',
        passing: false,
        metricsPassing: false,
        reason: 'report_missing',
        exitStatus: 0,
      });
      expect(existsSync(reportPath)).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects and does not promote a report from an older schema', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'kavi-provider-matrix-version-'));
    const reportPath = join(projectRoot, 'reports', 'gemini.json');
    const scriptPath = join(projectRoot, 'legacy-report.js');
    writeFileSync(
      scriptPath,
      "require('fs').writeFileSync(process.env.E2E_REPORT_PATH, JSON.stringify({schemaVersion:'e2e-run-report-v1',metricsPassing:true}));\n",
      'utf8',
    );

    try {
      const summary = runProviderBatchForMatrix({
        projectRoot,
        run: createRun(reportPath),
        assessmentScriptPath: scriptPath,
        env: {},
        stdio: 'pipe',
      });

      expect(summary).toMatchObject({
        status: 'failed',
        passing: false,
        metricsPassing: false,
        reason: 'report_version_mismatch',
        exitStatus: 0,
      });
      expect(existsSync(reportPath)).toBe(false);
      expect(readdirSync(join(projectRoot, 'reports'))).toEqual([]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
