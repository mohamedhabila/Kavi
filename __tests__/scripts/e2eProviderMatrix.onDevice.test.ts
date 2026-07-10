import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const {
  attachOnDeviceMatrixReport,
  buildMatrixRunPlanWithOnDeviceSelection,
  buildOnDeviceMatrixSummary,
  runOnDeviceBenchmarkForMatrix,
  splitProviderSelection,
} = require('../../scripts/e2eReport/onDeviceMatrix');
const { summarizeMatrixReport } = require('../../scripts/e2eReport/providerMatrix');
const { ON_DEVICE_BENCHMARK_VERSION } = require('../../scripts/onDeviceBenchmark/constants');

describe('e2e provider matrix on-device integration', () => {
  it('splits cloud providers from on-device provider aliases', () => {
    expect(
      splitProviderSelection({
        E2E_PROVIDER_MATRIX_PROVIDERS: 'gemini,on-device,openai,local-llm',
      }),
    ).toEqual({
      explicit: true,
      includeOnDevice: true,
      cloudProviders: ['gemini', 'openai'],
    });

    expect(splitProviderSelection({ E2E_PROVIDER_MATRIX_INCLUDE_ON_DEVICE: '1' })).toEqual({
      explicit: false,
      includeOnDevice: true,
      cloudProviders: [],
    });
  });

  it('builds an on-device-only matrix plan without inventing cloud runs', () => {
    const { plan, includeOnDevice } = buildMatrixRunPlanWithOnDeviceSelection({
      projectRoot: '/repo',
      generatedAt: '2026-06-17T10:00:00.000Z',
      env: {
        E2E_PROVIDER_MATRIX_PROVIDERS: 'on-device',
      },
    });

    expect(includeOnDevice).toBe(true);
    expect(plan.providerKeys).toEqual([]);
    expect(plan.runs).toEqual([]);
    expect(plan.reportDir).toBe('/repo/.artifacts/e2e-provider-matrix/2026-06-17T10-00-00.000Z');
  });

  it('attaches passing on-device summaries without cross-provider scenario comparisons', () => {
    const matrixReport = summarizeMatrixReport(
      {
        version: 'test',
        generatedAt: '2026-06-17T10:00:00.000Z',
        runId: 'run',
        reportDir: '/repo/.artifacts/e2e-provider-matrix/run',
        providerKeys: [],
        batches: [],
        runs: [],
      },
      [],
    );
    const onDeviceSummary = buildOnDeviceMatrixSummary({
      exitStatus: 0,
      reportPath: '/repo/on-device.json',
      report: {
        version: ON_DEVICE_BENCHMARK_VERSION,
        generatedAt: '2026-06-17T10:00:00.000Z',
        status: 'passed',
        model: { modelId: 'gemma-4-E2B-it' },
        scenarios: [{ id: 'startup', status: 'passed' }],
        summary: {
          scenarioCount: 1,
          passedCount: 1,
          failedCount: 0,
          skippedCount: 0,
          passRate: 1,
          failedRequiredScenarioIds: [],
          missingRequiredScenarioIds: [],
          passing: true,
        },
        assessment: {
          confidenceLevel: 'high',
          missingCoverage: [],
        },
      },
    });

    const attached = attachOnDeviceMatrixReport(matrixReport, onDeviceSummary);

    expect(attached.overall).toMatchObject({
      passing: true,
      scenarioCount: 1,
      passedCount: 1,
      failedBatchRunCount: 0,
      onDeviceStatus: 'passed',
      onDeviceConfidenceLevel: 'high',
    });
    expect(attached.scenarioComparisons).toEqual([]);
    expect(attached.providerSummaries).toEqual([
      expect.objectContaining({
        providerKey: 'on-device',
        reportRelativePath: 'on-device.json',
        model: 'gemma-4-E2B-it',
        passRate: 1,
      }),
    ]);
  });

  it('reports skipped on-device coverage without failing passing cloud batches', () => {
    const matrixReport = {
      version: 'test',
      generatedAt: '2026-06-17T10:00:00.000Z',
      runId: 'run',
      reportDir: '/repo/.artifacts/e2e-provider-matrix/run',
      providerKeys: ['openai'],
      batches: [],
      results: [],
      providerSummaries: [{ providerKey: 'openai', passing: true }],
      scenarioComparisons: [],
      overall: {
        batchRunCount: 1,
        failedBatchRunCount: 0,
        skippedBatchRunCount: 0,
        scenarioCount: 2,
        passedCount: 2,
        failedCount: 0,
        passRate: 1,
        passing: true,
      },
    };
    const onDeviceSummary = buildOnDeviceMatrixSummary({
      exitStatus: 0,
      reportPath: '/repo/on-device.json',
      report: {
        version: ON_DEVICE_BENCHMARK_VERSION,
        generatedAt: '2026-06-17T10:00:00.000Z',
        status: 'skipped',
        reason: 'device_unavailable',
        model: { modelId: null },
        scenarios: [],
        summary: {
          scenarioCount: 0,
          passedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          passRate: 0,
          failedRequiredScenarioIds: [],
          missingRequiredScenarioIds: [],
          passing: false,
        },
      },
    });

    const attached = attachOnDeviceMatrixReport(matrixReport, onDeviceSummary);

    expect(attached.overall).toMatchObject({
      passing: true,
      skippedBatchRunCount: 1,
      onDeviceStatus: 'skipped',
    });
  });

  it('fails a passed report when the current benchmark process failed', () => {
    const summary = buildOnDeviceMatrixSummary({
      exitStatus: 1,
      reportPath: '/repo/on-device.json',
      report: {
        version: ON_DEVICE_BENCHMARK_VERSION,
        generatedAt: '2026-06-17T10:00:00.000Z',
        status: 'passed',
        model: { modelId: 'gemma-4-E2B-it' },
        scenarios: [{ id: 'startup', status: 'passed' }],
        summary: {
          scenarioCount: 1,
          passedCount: 1,
          failedCount: 0,
          skippedCount: 0,
          passRate: 1,
          failedRequiredScenarioIds: [],
          missingRequiredScenarioIds: [],
          passing: true,
        },
      },
    });

    expect(summary).toMatchObject({
      status: 'failed',
      passing: false,
      metricsPassing: false,
      reason: 'benchmark_process_failed',
      exitStatus: 1,
    });
  });

  it('rejects reports from any previous benchmark contract', () => {
    const summary = buildOnDeviceMatrixSummary({
      exitStatus: 0,
      reportPath: '/repo/on-device.json',
      report: {
        version: 'legacy-on-device-report',
        status: 'passed',
      },
    });

    expect(summary).toMatchObject({
      status: 'failed',
      passing: false,
      metricsPassing: false,
      reason: 'report_version_mismatch',
    });
  });

  it('rejects malformed reports that only claim the current version', () => {
    const summary = buildOnDeviceMatrixSummary({
      exitStatus: 0,
      reportPath: '/repo/on-device.json',
      report: {
        version: ON_DEVICE_BENCHMARK_VERSION,
        status: 'passed',
      },
    });

    expect(summary).toMatchObject({
      status: 'failed',
      passing: false,
      metricsPassing: false,
      reason: 'report_contract_invalid',
    });
  });

  it('does not reuse a stale target report when the current process produces none', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'kavi-on-device-matrix-stale-'));
    const reportDir = join(projectRoot, 'reports');
    const scriptsDir = join(projectRoot, 'scripts');
    const reportPath = join(reportDir, 'on-device-benchmark.json');
    mkdirSync(reportDir, { recursive: true });
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify({ version: ON_DEVICE_BENCHMARK_VERSION, status: 'passed' }),
      'utf8',
    );
    writeFileSync(join(scriptsDir, 'on-device-benchmark.js'), 'process.exit(1);\n', 'utf8');

    try {
      const summary = runOnDeviceBenchmarkForMatrix({ projectRoot, reportDir, env: {} });

      expect(summary).toMatchObject({
        status: 'failed',
        passing: false,
        metricsPassing: false,
        reason: 'report_missing',
        exitStatus: 1,
      });
      expect(existsSync(reportPath)).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
