import {
  buildE2ERunReport,
  buildE2ERunReportScenarioEntry,
  digestE2EProviderEndpoint,
  formatE2ERunReportSummary,
  resolveE2ERunMetadata,
} from '../../src/acceptance/e2eAgent/e2eRunReport';
import { E2E_SCENARIO_MANIFEST_VERSION } from '../../src/acceptance/e2eAgent/thresholds';

import {
  buildFixtureResult,
  installE2ERunReportFixtureReset,
} from '../helpers/e2eRunReportHarness';

const {
  digestModelLocator: digestNodeModelLocator,
  digestProviderEndpoint: digestNodeProviderEndpoint,
  resolvePublicModelIdentity: resolveNodePublicModelIdentity,
  resolveHostedFamily: resolveNodeHostedFamily,
} = require('../../scripts/e2eReport/provenance');

describe('e2eRunReport scoring and reliability', () => {
  installE2ERunReportFixtureReset();

  it('fingerprints a canonical endpoint without credential or query variance', () => {
    const privateEndpoint =
      'https://private-user:private-password@example.invalid/v1/?token=private#fragment';
    const canonicalDigest = digestE2EProviderEndpoint('https://example.invalid/v1');
    expect(digestE2EProviderEndpoint(privateEndpoint)).toBe(canonicalDigest);
    expect(digestNodeProviderEndpoint(privateEndpoint)).toBe(canonicalDigest);

    const metadata = resolveE2ERunMetadata(
      {
        providerKey: 'openrouter',
        modelLocator: 'openrouter/anthropic/claude-test',
        providerEndpoint: privateEndpoint,
      },
      { E2E_GIT_SHA: 'a'.repeat(40) },
    );
    expect(metadata).toMatchObject({
      hostedFamily: resolveNodeHostedFamily('openrouter/anthropic/claude-test'),
      model: 'claude-test',
      modelIdentitySource: 'provider-model-id',
      modelLocatorSha256: digestNodeModelLocator('openrouter/anthropic/claude-test'),
      endpointSha256: canonicalDigest,
    });
  });

  it('publishes an explicit compatible model identity and only a runtime locator digest', () => {
    const privateModelLocator =
      'file:///Users/private-model-owner/models/qwen-private.gguf?token=private-model-token';
    const metadata = resolveE2ERunMetadata(
      {
        providerKey: 'compatible',
        gitSha: 'b'.repeat(40),
        hostedFamily: 'qwen',
        model: 'qwen2.5-mobile-eval',
        modelLocator: privateModelLocator,
        modelVersion: 'revision-2026.07',
        providerEndpoint: 'https://private-user:private-pass@example.invalid/v1?token=private',
        promptCacheMode: 'disabled',
        seed: 42,
      },
      {},
    );
    const nodeIdentity = resolveNodePublicModelIdentity({
      providerKey: 'compatible',
      modelLocator: privateModelLocator,
      publicModelId: 'qwen2.5-mobile-eval',
    });

    expect(metadata).toMatchObject({
      provider: 'custom',
      providerId: 'e2e-compatible',
      hostedFamily: 'qwen',
      model: 'qwen2.5-mobile-eval',
      modelIdentitySource: 'explicit-public-id',
      modelLocatorSha256: digestNodeModelLocator(privateModelLocator),
      modelVersion: 'revision-2026.07',
      promptCacheMode: 'disabled',
      seed: 42,
    });
    expect(metadata).toMatchObject(nodeIdentity);
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain('private-model-owner');
    expect(serialized).not.toContain('qwen-private.gguf');
    expect(serialized).not.toContain('private-model-token');
    expect(serialized).not.toContain('private-user');
    expect(serialized).not.toContain('private-pass');
  });

  it('rejects unsafe or ambiguous public provenance metadata', () => {
    const compatibleBase = {
      providerKey: 'compatible' as const,
      gitSha: 'c'.repeat(40),
      modelLocator: '/Users/private/model.gguf',
      providerEndpoint: 'http://127.0.0.1:11434/v1',
    };

    expect(() => resolveE2ERunMetadata(compatibleBase, {})).toThrow('require E2E_PUBLIC_MODEL_ID');
    expect(() =>
      resolveE2ERunMetadata({ ...compatibleBase, model: '../private/model.gguf' }, {}),
    ).toThrow('path-free model identifier');
    expect(() =>
      resolveE2ERunMetadata({ ...compatibleBase, model: 'safe-model', gitSha: 'private-sha' }, {}),
    ).toThrow('hexadecimal revision');
    expect(() =>
      resolveE2ERunMetadata(
        { ...compatibleBase, model: 'safe-model', modelVersion: 'private/version?token=secret' },
        {},
      ),
    ).toThrow('public revision token');
    expect(() =>
      resolveE2ERunMetadata({ ...compatibleBase, model: 'safe-model' }, { E2E_SEED: 'secret' }),
    ).toThrow('unsigned 32-bit integer');
    expect(() =>
      resolveE2ERunMetadata(
        { ...compatibleBase, model: 'safe-model' },
        { E2E_PROMPT_CACHE_MODE: 'private-cache-mode' },
      ),
    ).toThrow('provider-default, enabled, or disabled');
    expect(() =>
      resolveE2ERunMetadata(
        { ...compatibleBase, model: 'safe-model' },
        { E2E_PUBLIC_HOSTED_FAMILY: 'private-family' },
      ),
    ).toThrow('supported public family');
  });

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
        providerKey: 'gemini',
        gitSha: 'd'.repeat(40),
        modelLocator: 'gemini-3.5-flash',
        providerEndpoint: 'https://aiplatform.googleapis.com/v1',
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
      gitSha: 'd'.repeat(40),
      hostedFamily: 'gemini',
      model: 'gemini-3.5-flash',
      modelIdentitySource: 'provider-model-id',
      modelLocatorSha256: digestNodeModelLocator('gemini-3.5-flash'),
      endpointSha256: digestE2EProviderEndpoint('https://aiplatform.googleapis.com/v1'),
      collectMode: true,
      scenarioManifestVersion: E2E_SCENARIO_MANIFEST_VERSION,
    });
    expect(JSON.stringify(report.runMetadata)).not.toContain('aiplatform.googleapis.com');
    expect(report.runMetadata).not.toHaveProperty('providerBaseUrl');
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
