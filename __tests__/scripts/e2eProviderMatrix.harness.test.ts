const {
  PROVIDER_MATRIX_BATCHES,
  buildMatrixRunPlan,
  buildProviderBatchSummary,
  parseCsvEnv,
  resolveBatchSelection,
  resolveProviderCredentialStatus,
  resolveProviderKeys,
  summarizeMatrixReport,
} = require('../../scripts/e2eReport/providerMatrix');

describe('e2e provider matrix helpers', () => {
  it('builds a focused Gemini/OpenAI default run plan', () => {
    const plan = buildMatrixRunPlan({
      projectRoot: '/repo',
      env: {},
      generatedAt: '2026-06-15T10:00:00.000Z',
    });

    expect(plan.providerKeys).toEqual(['gemini', 'openai']);
    expect(plan.batches.map((batch: { id: string }) => batch.id)).toEqual(['provider-core']);
    expect(plan.runs).toHaveLength(2);
    expect(plan.runs[0]).toMatchObject({
      providerKey: 'gemini',
      batchId: 'provider-core',
      scenarioIds: [
        'bench-prompt-cache-long-horizon',
        'bench-androidworld-calendar-mutation',
        'delegation-worker-evidence-chain',
      ],
      reportPath:
        '/repo/.artifacts/e2e-provider-matrix/2026-06-15T10-00-00.000Z/gemini-provider-core.json',
    });
  });

  it('resolves provider aliases and explicit batch selections', () => {
    expect(parseCsvEnv('google, openai anthropic openrouter')).toEqual([
      'google',
      'openai',
      'anthropic',
      'openrouter',
    ]);
    expect(resolveProviderKeys({ E2E_PROVIDER_MATRIX_PROVIDERS: 'google claude openai' })).toEqual([
      'gemini',
      'anthropic',
      'openai',
    ]);
    expect(
      resolveBatchSelection({ E2E_PROVIDER_MATRIX_BATCHES: 'memory-long-run,mobile-native' }).map(
        (batch: { id: string }) => batch.id,
      ),
    ).toEqual(['memory-long-run', 'mobile-native']);
    expect(resolveBatchSelection({ E2E_PROVIDER_MATRIX_BATCHES: 'all' })).toHaveLength(
      PROVIDER_MATRIX_BATCHES.length,
    );
  });

  it('validates provider-specific credentials without changing provider behavior', () => {
    expect(
      resolveProviderCredentialStatus('gemini', {
        GEMINI_API_KEY: 'gemini-key',
      }),
    ).toMatchObject({
      configured: true,
      model: 'gemini-3.5-flash',
      baseUrl: 'https://aiplatform.googleapis.com/v1',
    });

    expect(
      resolveProviderCredentialStatus('openai', {
        OPENAI_API_KEY: 'openai-key',
      }),
    ).toMatchObject({
      configured: false,
      missing: ['E2E_OPENAI_MODEL'],
    });

    expect(
      resolveProviderCredentialStatus('openai', {
        OPENAI_API_KEY: 'openai-key',
        E2E_OPENAI_MODEL: 'gpt-test',
      }),
    ).toMatchObject({
      configured: true,
      model: 'gpt-test',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(
      resolveProviderCredentialStatus('anthropic', {
        ANTHROPIC_API_KEY: 'anthropic-key',
      }),
    ).toMatchObject({
      configured: false,
      missing: ['E2E_ANTHROPIC_MODEL'],
    });

    expect(
      resolveProviderCredentialStatus('anthropic', {
        ANTHROPIC_API_KEY: 'anthropic-key',
        E2E_ANTHROPIC_MODEL: 'claude-test',
      }),
    ).toMatchObject({
      configured: true,
      model: 'claude-test',
      baseUrl: 'https://api.anthropic.com/v1',
    });
  });

  it('summarizes provider runs and exposes cross-provider failures', () => {
    const plan = buildMatrixRunPlan({
      projectRoot: '/repo',
      env: {},
      generatedAt: '2026-06-15T10:00:00.000Z',
    });
    const geminiSummary = buildProviderBatchSummary({
      ...plan.runs[0],
      exitStatus: 0,
      report: buildReport('gemini', true),
    });
    const openaiSummary = buildProviderBatchSummary({
      ...plan.runs[1],
      exitStatus: 0,
      report: buildReport('openai', false),
    });

    const matrixReport = summarizeMatrixReport(plan, [geminiSummary, openaiSummary]);

    expect(geminiSummary).toMatchObject({
      status: 'passed',
      passedCount: 2,
      scenarioCount: 2,
      eligibleCacheReadRate: 0.5,
    });
    expect(openaiSummary).toMatchObject({
      status: 'failed',
      failedScenarioIds: ['bench-androidworld-calendar-mutation'],
    });
    expect(matrixReport.overall).toMatchObject({
      passing: false,
      scenarioCount: 4,
      passedCount: 3,
      failedCount: 1,
    });
    expect(matrixReport.providerSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerKey: 'gemini', passing: true }),
        expect.objectContaining({ providerKey: 'openai', passing: false }),
      ]),
    );
    expect(
      matrixReport.scenarioComparisons.find(
        (comparison: { fixtureId: string }) =>
          comparison.fixtureId === 'bench-androidworld-calendar-mutation',
      ),
    ).toMatchObject({
      passingAcrossProviders: false,
      failedProviders: ['openai'],
    });
  });

  it('does not let non-eligible cache reads inflate eligible cache rates', () => {
    const plan = buildMatrixRunPlan({
      projectRoot: '/repo',
      env: { E2E_PROVIDER_MATRIX_PROVIDERS: 'openai' },
      generatedAt: '2026-06-15T10:00:00.000Z',
    });
    const report = buildReport('openai', true);
    report.scenarios[1].usage.cacheReadTokens = 3000;
    report.totals.cacheReadTokens = 5500;
    report.cache.cacheReadTokens = 5500;
    report.cache.eligibleCacheReadRate = 0.5;

    const summary = buildProviderBatchSummary({
      ...plan.runs[0],
      exitStatus: 0,
      report,
    });
    const matrixReport = summarizeMatrixReport(plan, [summary]);

    expect(summary.cacheReadTokens).toBe(5500);
    expect(summary.eligibleCacheReadRate).toBe(0.5);
    expect(matrixReport.providerSummaries[0].cacheReadRate).toBeCloseTo(5500 / 6000);
    expect(matrixReport.providerSummaries[0].eligibleCacheReadRate).toBe(0.5);
    expect(matrixReport.overall.eligibleCacheReadRate).toBe(0.5);
  });
});

function buildReport(provider: string, calendarPassed: boolean) {
  const scenarios = [
    {
      fixtureId: 'bench-prompt-cache-long-horizon',
      passed: true,
      attemptCount: 1,
      usage: {
        inputTokens: 5000,
        outputTokens: 100,
        cacheReadTokens: 2500,
        totalTokens: 5100,
      },
      cache: {
        eligibleInputTokens: 5000,
      },
    },
    {
      fixtureId: 'bench-androidworld-calendar-mutation',
      passed: calendarPassed,
      attemptCount: calendarPassed ? 1 : 2,
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 0,
        totalTokens: 1200,
      },
      cache: {
        eligibleInputTokens: 0,
      },
    },
  ];

  return {
    runMetadata: {
      provider,
      providerId: `e2e-${provider}`,
      model: `${provider}-test`,
    },
    totals: {
      scenarioCount: 2,
      passedCount: calendarPassed ? 2 : 1,
      failedCount: calendarPassed ? 0 : 1,
      inputTokens: 6000,
      outputTokens: 300,
      cacheReadTokens: 2500,
      totalTokens: 6300,
    },
    cache: {
      eligibleInputTokens: 5000,
      cacheReadTokens: 2500,
      cacheReadRate: 2500 / 6000,
      eligibleCacheReadRate: 0.5,
      passing: true,
    },
    reliability: {
      scenarioCount: 2,
      pass1PassedCount: calendarPassed ? 2 : 1,
      pass1Rate: calendarPassed ? 1 : 0.5,
      passKRate: calendarPassed ? 1 : 0.5,
      retriedScenarioCount: calendarPassed ? 0 : 1,
    },
    assessment: {
      evidenceScore: calendarPassed ? 1 : 0.5,
    },
    scenarios,
    metricsPassing: calendarPassed,
  };
}
