const path = require('path');
const shellQuote = require('shell-quote');
const {
  ON_DEVICE_BENCHMARK_ARTIFACT_DIR,
  ON_DEVICE_BENCHMARK_DRIVER_REPORT_NAME,
  ON_DEVICE_BENCHMARK_PLAN_NAME,
  ON_DEVICE_BENCHMARK_REPORT_NAME,
  ON_DEVICE_BENCHMARK_VERSION,
} = require('./constants');
const { readGalleryBaseline } = require('./galleryBaseline');
const { parseScenarioSelection } = require('./scenarios');

function readEnv(env, key) {
  const value = env[key]?.trim();
  return value || undefined;
}

function parsePositiveInteger(rawValue, fallback) {
  if (!rawValue?.trim()) {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${rawValue}`);
  }
  return parsed;
}

function parseBooleanFlag(rawValue, fallback = false) {
  if (!rawValue?.trim()) {
    return fallback;
  }
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false;
  }
  throw new Error(`Expected a boolean flag, received: ${rawValue}`);
}

function parseCommand(rawValue) {
  if (!rawValue?.trim()) {
    return undefined;
  }

  const parsed = shellQuote.parse(rawValue);
  const tokens = parsed.map((token) => {
    if (typeof token !== 'string') {
      throw new Error('E2E_ON_DEVICE_BENCHMARK_COMMAND must not contain shell operators.');
    }
    return token;
  });
  if (tokens.length === 0) {
    return undefined;
  }
  return {
    command: tokens[0],
    args: tokens.slice(1),
  };
}

function resolveReportPaths(projectRoot, env) {
  const reportPath = path.resolve(
    projectRoot,
    readEnv(env, 'E2E_ON_DEVICE_REPORT_PATH') ||
      path.join(ON_DEVICE_BENCHMARK_ARTIFACT_DIR, ON_DEVICE_BENCHMARK_REPORT_NAME),
  );
  const artifactDir = path.dirname(reportPath);
  return {
    artifactDir,
    reportPath,
    planPath: path.join(artifactDir, ON_DEVICE_BENCHMARK_PLAN_NAME),
    driverReportPath: path.join(artifactDir, ON_DEVICE_BENCHMARK_DRIVER_REPORT_NAME),
  };
}

function buildOnDeviceBenchmarkConfig(options) {
  const env = options.env || process.env;
  const projectRoot = options.projectRoot;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const platform = readEnv(env, 'E2E_ON_DEVICE_PLATFORM') || 'android';
  if (platform !== 'android' && platform !== 'ios') {
    throw new Error(`Unsupported E2E_ON_DEVICE_PLATFORM: ${platform}`);
  }

  const paths = resolveReportPaths(projectRoot, env);
  const modelId = readEnv(env, 'E2E_ON_DEVICE_MODEL_ID');
  const runtime =
    readEnv(env, 'E2E_ON_DEVICE_RUNTIME') || (platform === 'android' ? 'litert-lm' : 'litert-lm');

  return {
    version: ON_DEVICE_BENCHMARK_VERSION,
    generatedAt,
    projectRoot,
    enabled: env.RUN_ON_DEVICE_LLM_BENCHMARK === '1',
    platform,
    appId: readEnv(env, 'E2E_ON_DEVICE_APP_ID') || 'com.kavi.mobile',
    device: {
      deviceId: readEnv(env, 'E2E_ON_DEVICE_DEVICE_ID'),
    },
    modelId,
    modelPath: readEnv(env, 'E2E_ON_DEVICE_MODEL_PATH'),
    modelCapabilities: {
      tools: parseBooleanFlag(env.E2E_ON_DEVICE_MODEL_SUPPORTS_TOOLS),
    },
    runtime,
    backend: readEnv(env, 'E2E_ON_DEVICE_BACKEND'),
    conversationTurns: parsePositiveInteger(env.E2E_ON_DEVICE_CONVERSATION_TURNS, 20),
    scenarios: parseScenarioSelection(env.E2E_ON_DEVICE_SCENARIOS),
    galleryBaseline: readGalleryBaseline(projectRoot, env.E2E_ON_DEVICE_GALLERY_BASELINE_PATH),
    driverCommand: parseCommand(env.E2E_ON_DEVICE_BENCHMARK_COMMAND),
    skipDeviceProbe: env.E2E_ON_DEVICE_SKIP_DEVICE_PROBE === '1',
    ...paths,
  };
}

module.exports = {
  buildOnDeviceBenchmarkConfig,
  parseCommand,
  parseBooleanFlag,
  parsePositiveInteger,
};
