const ON_DEVICE_BENCHMARK_VERSION = '2026-06-17.on-device-phase9';
const ON_DEVICE_BENCHMARK_ARTIFACT_DIR = '.artifacts/e2e-on-device-benchmark';
const ON_DEVICE_BENCHMARK_REPORT_NAME = 'on-device-benchmark-report.json';
const ON_DEVICE_BENCHMARK_PLAN_NAME = 'on-device-benchmark-plan.json';
const ON_DEVICE_BENCHMARK_DRIVER_REPORT_NAME = 'on-device-driver-report.json';

const REQUIRED_LIVE_METRIC_KEYS = [
  'engineInitMs',
  'ttftMs',
  'decodeTokensPerSecond',
  'outputTokens',
  'activeBackend',
  'backendFallbackCount',
  'backendFallbackReason',
  'nativeCrashed',
  'nativeErrorType',
  'nativeErrorMessage',
  'conversationCacheHits',
  'conversationCacheMisses',
  'memoryBeforeMb',
  'memoryAfterMb',
  'contextWindowTokens',
  'inputTokens',
  'inputBudgetTokens',
  'contextPressureRatio',
  'contextCompactionState',
  'constrainedDecodingEnabled',
  'speculativeDecodingSupported',
  'speculativeDecodingEnabled',
  'capabilityCheckFailed',
];

module.exports = {
  ON_DEVICE_BENCHMARK_ARTIFACT_DIR,
  ON_DEVICE_BENCHMARK_DRIVER_REPORT_NAME,
  ON_DEVICE_BENCHMARK_PLAN_NAME,
  ON_DEVICE_BENCHMARK_REPORT_NAME,
  ON_DEVICE_BENCHMARK_VERSION,
  REQUIRED_LIVE_METRIC_KEYS,
};
