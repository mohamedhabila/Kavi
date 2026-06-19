const {
  attachOnDeviceMatrixReport,
  buildMatrixRunPlanWithOnDeviceSelection,
  buildOnDeviceMatrixSummary,
  splitProviderSelection,
} = require('../../scripts/e2eReport/onDeviceMatrix');
const { summarizeMatrixReport } = require('../../scripts/e2eReport/providerMatrix');

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
        status: 'passed',
        model: { modelId: 'gemma-4-E2B-it' },
        summary: {
          scenarioCount: 10,
          passedCount: 10,
          failedCount: 0,
          skippedCount: 0,
          passRate: 1,
          failedRequiredScenarioIds: [],
          missingRequiredScenarioIds: [],
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
      scenarioCount: 10,
      passedCount: 10,
      failedBatchRunCount: 0,
      onDeviceStatus: 'passed',
      onDeviceConfidenceLevel: 'high',
    });
    expect(attached.scenarioComparisons).toEqual([]);
    expect(attached.providerSummaries).toEqual([
      expect.objectContaining({
        providerKey: 'on-device',
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
        status: 'skipped',
        reason: 'device_unavailable',
        summary: {
          scenarioCount: 0,
          passedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          passRate: 0,
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
});
