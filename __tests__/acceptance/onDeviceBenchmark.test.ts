import fs from 'fs';
import os from 'os';
import path from 'path';

const { REQUIRED_LIVE_METRIC_KEYS } = require('../../scripts/onDeviceBenchmark/constants');
const {
  buildOnDeviceBenchmarkConfig,
  parseBooleanFlag,
  parseCommand,
} = require('../../scripts/onDeviceBenchmark/config');
const { parseAdbDevices } = require('../../scripts/onDeviceBenchmark/deviceProbe');
const {
  buildCompletedReport,
  buildSkippedReport,
} = require('../../scripts/onDeviceBenchmark/report');
const { buildScenarioPlan } = require('../../scripts/onDeviceBenchmark/scenarios');
const {
  resolvePreflight,
  runOnDeviceBenchmark,
} = require('../../scripts/onDeviceBenchmark/runner');
const {
  assertUsableModelPath: assertUsableIosModelPath,
  parseArgs: parseIosDriverArgs,
  resolveDeviceId: resolveIosDeviceId,
} = require('../../scripts/on-device-benchmark-ios-driver');

const tempProjectRoots: string[] = [];

function createTempProjectRoot(): string {
  const tempProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kavi-on-device-benchmark-'));
  tempProjectRoots.push(tempProjectRoot);
  return tempProjectRoot;
}

function createConfig(overrides: Record<string, string | undefined> = {}) {
  return buildOnDeviceBenchmarkConfig({
    projectRoot: createTempProjectRoot(),
    generatedAt: '2026-06-17T00:00:00.000Z',
    env: {
      ...overrides,
    },
  });
}

function buildMetricRecord(overrides: Record<string, unknown> = {}) {
  return Object.fromEntries(
    REQUIRED_LIVE_METRIC_KEYS.map((key: string) => [key, null]).concat(
      Object.entries({
        engineInitMs: 1200,
        ttftMs: 240,
        decodeTokensPerSecond: 18,
        outputTokens: 32,
        activeBackend: 'gpu',
        backendFallbackCount: 0,
        nativeCrashed: false,
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
      }),
    ),
  );
}

describe('on-device benchmark harness', () => {
  afterEach(() => {
    while (tempProjectRoots.length > 0) {
      fs.rmSync(tempProjectRoots.pop() as string, { force: true, recursive: true });
    }
  });

  it('parses driver commands without allowing shell operators', () => {
    expect(parseCommand('node ./driver.js --flag value')).toEqual({
      command: 'node',
      args: ['./driver.js', '--flag', 'value'],
    });
    expect(() => parseCommand('node ./driver.js && rm -rf /')).toThrow(
      /must not contain shell operators/u,
    );
  });

  it('parses benchmark model capability flags explicitly', () => {
    expect(parseBooleanFlag('true')).toBe(true);
    expect(parseBooleanFlag('0')).toBe(false);
    expect(() => parseBooleanFlag('sometimes')).toThrow(/Expected a boolean flag/u);
  });

  it('parses attached Android devices from adb output', () => {
    expect(
      parseAdbDevices(`List of devices attached
emulator-5554          device product:sdk_gphone64 model:Pixel_9
offline-device         offline
`),
    ).toEqual([
      { deviceId: 'emulator-5554', state: 'device' },
      { deviceId: 'offline-device', state: 'offline' },
    ]);
  });

  it('skips before runtime start when benchmark opt-in is missing', () => {
    const config = createConfig();

    expect(resolvePreflight(config)).toMatchObject({
      ok: false,
      skipped: true,
      reason: 'benchmark_not_enabled',
    });
  });

  it('builds a device plan with the required baseline scenarios', () => {
    const config = createConfig({
      RUN_ON_DEVICE_LLM_BENCHMARK: '1',
      E2E_ON_DEVICE_MODEL_ID: 'gemma-4-E2B-it',
      E2E_ON_DEVICE_MODEL_SUPPORTS_TOOLS: 'true',
      E2E_ON_DEVICE_BENCHMARK_COMMAND: 'node ./driver.js',
      E2E_ON_DEVICE_SKIP_DEVICE_PROBE: '1',
    });
    const plan = buildScenarioPlan({
      ...config,
      device: { deviceId: 'emulator-5554' },
    });

    expect(plan.scenarios.map((scenario: { id: string }) => scenario.id)).toEqual([
      'local-model-availability',
      'local-model-warmup',
      'single-turn-streaming',
      'cancel-mid-stream',
      'twenty-turn-conversation',
      'fifty-turn-conversation',
      'multi-turn-memory-recall',
      'context-pressure-conversation',
      'error-recovery-after-cancel',
      'background-foreground-interruption',
      'backend-fallback',
      'native-tool-call',
    ]);
    expect(plan.defaults.conversationTurns).toBe(20);
    expect(plan.model.modelId).toBe('gemma-4-E2B-it');
    expect(plan.model.capabilities.tools).toBe(true);
  });

  it('summarizes a complete strict driver report', () => {
    const config = createConfig({
      E2E_ON_DEVICE_MODEL_ID: 'gemma-4-E2B-it',
    });
    const plan = buildScenarioPlan({
      ...config,
      device: { deviceId: 'emulator-5554' },
    });
    const report = buildCompletedReport(config, plan, {
      scenarios: plan.scenarios.map((scenario: { id: string; required: boolean }) => ({
        id: scenario.id,
        status: scenario.required ? 'passed' : 'skipped',
        durationMs: scenario.required ? 1000 : null,
        metrics: scenario.required ? buildMetricRecord() : {},
      })),
    });

    expect(report.status).toBe('passed');
    expect(report.summary).toMatchObject({
      scenarioCount: 12,
      passedCount: 10,
      skippedCount: 2,
      failedRequiredScenarioIds: [],
      missingRequiredScenarioIds: [],
      crashFree: true,
      passing: true,
    });
  });

  it('rejects live scenario reports that omit required telemetry keys', () => {
    const config = createConfig({
      E2E_ON_DEVICE_MODEL_ID: 'gemma-4-E2B-it',
    });
    const plan = buildScenarioPlan({
      ...config,
      device: { deviceId: 'emulator-5554' },
    });

    expect(() =>
      buildCompletedReport(config, plan, {
        scenarios: [
          {
            id: 'local-model-availability',
            status: 'passed',
            durationMs: 1,
            metrics: { activeBackend: 'gpu' },
          },
        ],
      }),
    ).toThrow(/missing metric keys/u);
  });

  it('writes a skipped report cleanly without a driver or device', () => {
    const projectRoot = createTempProjectRoot();
    const result = runOnDeviceBenchmark({
      projectRoot,
      generatedAt: '2026-06-17T00:00:00.000Z',
      env: {},
    });

    expect(result.exitStatus).toBe(0);
    expect(result.report).toEqual(
      expect.objectContaining({
        status: 'skipped',
        reason: 'benchmark_not_enabled',
      }),
    );
    expect(fs.existsSync(result.config.reportPath)).toBe(true);
  });

  it('builds skipped reports with stable model and platform metadata', () => {
    const config = createConfig({
      E2E_ON_DEVICE_MODEL_ID: 'gemma-4-E2B-it',
      E2E_ON_DEVICE_BACKEND: 'gpu',
    });

    expect(buildSkippedReport(config, 'driver_command_missing')).toMatchObject({
      status: 'skipped',
      reason: 'driver_command_missing',
      platform: 'android',
      app: { appId: 'com.kavi.mobile' },
      model: {
        modelId: 'gemma-4-E2B-it',
        runtime: 'litert-lm',
        backend: 'gpu',
        capabilities: {
          tools: false,
        },
      },
      summary: {
        scenarioCount: 0,
        crashFree: true,
        passing: false,
      },
    });
  });

  it('validates iOS driver arguments and model paths before xcodebuild', () => {
    const projectRoot = createTempProjectRoot();
    const modelPath = path.join(projectRoot, 'model.litertlm');
    fs.writeFileSync(modelPath, 'model-bytes', 'utf8');

    expect(parseIosDriverArgs(['--plan', '/tmp/plan.json', '--report', '/tmp/report.json'])).toEqual({
      planPath: '/tmp/plan.json',
      reportPath: '/tmp/report.json',
    });
    expect(resolveIosDeviceId({ device: { deviceId: 'simulator-id' } })).toBe('simulator-id');
    expect(assertUsableIosModelPath({ model: { modelPath } })).toBe(modelPath);
    expect(() =>
      assertUsableIosModelPath({ model: { modelPath: path.join(projectRoot, 'missing.litertlm') } }),
    ).toThrow(/not readable/u);
  });
});
