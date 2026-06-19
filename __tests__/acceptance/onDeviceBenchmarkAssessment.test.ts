import fs from 'fs';
import os from 'os';
import path from 'path';

const { buildOnDeviceBenchmarkConfig } = require('../../scripts/onDeviceBenchmark/config');
const { buildCompletedReport } = require('../../scripts/onDeviceBenchmark/report');
const { buildScenarioPlan } = require('../../scripts/onDeviceBenchmark/scenarios');

const tempProjectRoots: string[] = [];

function createTempProjectRoot(): string {
  const tempProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kavi-on-device-assessment-'));
  tempProjectRoots.push(tempProjectRoot);
  return tempProjectRoot;
}

function createConfig(overrides: Record<string, string | undefined> = {}) {
  return buildOnDeviceBenchmarkConfig({
    projectRoot: createTempProjectRoot(),
    generatedAt: '2026-06-17T00:00:00.000Z',
    env: {
      E2E_ON_DEVICE_MODEL_ID: 'gemma-4-E2B-it',
      E2E_ON_DEVICE_MODEL_SUPPORTS_TOOLS: 'true',
      ...overrides,
    },
  });
}

function buildMetricRecord(overrides: Record<string, unknown> = {}) {
  return {
    engineInitMs: 1000,
    ttftMs: 250,
    decodeTokensPerSecond: 20,
    outputTokens: 32,
    activeBackend: 'gpu',
    backendFallbackCount: 0,
    backendFallbackReason: null,
    nativeCrashed: false,
    nativeErrorType: null,
    nativeErrorMessage: null,
    conversationCacheHits: 1,
    conversationCacheMisses: 0,
    memoryBeforeMb: 512,
    memoryAfterMb: 640,
    contextWindowTokens: 4096,
    inputTokens: 256,
    inputBudgetTokens: 3072,
    contextPressureRatio: 0.083,
    contextCompactionState: 'full',
    constrainedDecodingEnabled: false,
    speculativeDecodingSupported: true,
    speculativeDecodingEnabled: true,
    capabilityCheckFailed: false,
    ...overrides,
  };
}

describe('on-device benchmark assessment', () => {
  afterEach(() => {
    while (tempProjectRoots.length > 0) {
      fs.rmSync(tempProjectRoots.pop() as string, { force: true, recursive: true });
    }
  });

  it('reports medium confidence when live coverage passes without a Gallery baseline', () => {
    const config = createConfig();
    const plan = buildScenarioPlan({ ...config, device: { deviceId: 'emulator-5554' } });
    const report = buildCompletedReport(config, plan, {
      scenarios: plan.scenarios.map((scenario: { id: string; required: boolean }) => ({
        id: scenario.id,
        status: scenario.required ? 'passed' : 'skipped',
        durationMs: scenario.required ? 1000 : null,
        metrics: scenario.required ? buildMetricRecord() : {},
      })),
    });

    expect(report.assessment).toMatchObject({
      confidenceLevel: 'medium',
      missingCoverage: ['gallery_same_device_baseline'],
      galleryComparison: {
        status: 'missing_baseline',
        metrics: {
          engineInitMs: 1000,
          ttftMs: 250,
          decodeTokensPerSecond: 20,
          crashFreeRunRate: 1,
          activeBackend: 'gpu',
          contextWindowTokens: 4096,
        },
      },
    });
  });

  it('compares against a same-device Gallery baseline when provided', () => {
    const projectRoot = createTempProjectRoot();
    const baselinePath = path.join(projectRoot, 'gallery-baseline.json');
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        metrics: {
          engineInitMs: 2000,
          ttftMs: 500,
          decodeTokensPerSecond: 10,
          crashFreeRunRate: 1,
          activeBackend: 'gpu',
          contextWindowTokens: 4096,
        },
      }),
      'utf8',
    );
    const config = buildOnDeviceBenchmarkConfig({
      projectRoot,
      generatedAt: '2026-06-17T00:00:00.000Z',
      env: {
        E2E_ON_DEVICE_MODEL_ID: 'gemma-4-E2B-it',
        E2E_ON_DEVICE_MODEL_SUPPORTS_TOOLS: 'true',
        E2E_ON_DEVICE_GALLERY_BASELINE_PATH: baselinePath,
      },
    });
    const plan = buildScenarioPlan({ ...config, device: { deviceId: 'emulator-5554' } });
    const report = buildCompletedReport(config, plan, {
      scenarios: plan.scenarios.map((scenario: { id: string; required: boolean }) => ({
        id: scenario.id,
        status: scenario.required ? 'passed' : 'skipped',
        durationMs: scenario.required ? 1000 : null,
        metrics: scenario.required ? buildMetricRecord() : {},
      })),
    });

    expect(report.assessment).toMatchObject({
      confidenceLevel: 'high',
      missingCoverage: [],
      galleryComparison: {
        status: 'compared',
        ratios: {
          engineInitMs: 0.5,
          ttftMs: 0.5,
          decodeTokensPerSecond: 2,
          crashFreeRunRate: 1,
          contextWindowTokens: 1,
        },
      },
    });
  });

  it('keeps iOS package-level lifecycle coverage distinct from app lifecycle coverage', () => {
    const config = createConfig({ E2E_ON_DEVICE_PLATFORM: 'ios' });
    const plan = buildScenarioPlan({
      ...config,
      device: { deviceId: 'ios-simulator' },
    });
    const report = buildCompletedReport(config, plan, {
      scenarios: plan.scenarios.map((scenario: { id: string; required: boolean }) => ({
        id: scenario.id,
        status: scenario.required ? 'passed' : 'skipped',
        durationMs: scenario.required ? 1000 : null,
        metrics: scenario.required
          ? buildMetricRecord(
              scenario.id === 'background-foreground-interruption'
                ? { lifecycleInterruptionMode: 'xctest-idle' }
                : {},
            )
          : {},
      })),
    });

    expect(report.status).toBe('passed');
    expect(report.assessment.missingCoverage).toContain(
      'ios_true_background_foreground_lifecycle',
    );
  });
});
