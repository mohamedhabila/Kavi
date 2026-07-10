import { E2E_NATIVE_TOOL_FIXTURE_VERSION } from './thresholds';

export const E2E_NATIVE_PERMISSION_STATES = {
  granted: {
    calendar: { status: 'granted', canAskAgain: true },
    contacts: { status: 'granted', canAskAgain: true, accessPrivileges: 'all' },
    notifications: { status: 'granted', canAskAgain: true },
  },
  denied: {
    location: { status: 'denied', canAskAgain: true },
  },
  askEveryTime: {
    camera: { status: 'granted', canAskAgain: true, scope: 'ephemeral' },
  },
  unavailable: {
    screenCapture: { status: 'unavailable', canAskAgain: false },
  },
  revokedMidTask: {
    mediaLibrary: { status: 'revoked', canAskAgain: true },
  },
} as const;

export const E2E_FIXTURE_DEVICE_PERMISSIONS_JSON = JSON.stringify({
  version: E2E_NATIVE_TOOL_FIXTURE_VERSION,
  states: E2E_NATIVE_PERMISSION_STATES,
  current: {
    calendar: 'granted',
    contacts: 'granted',
    location: 'denied',
    camera: 'granted',
    mediaLibrary: 'revoked',
    notifications: 'granted',
    screenCapture: 'unavailable',
  },
});

export const E2E_FIXTURE_DEVICE_STATUS_JSON = JSON.stringify({
  fixtureVersion: E2E_NATIVE_TOOL_FIXTURE_VERSION,
  battery: { level: 72, state: 'unplugged' },
  network: { isConnected: true, type: 'WIFI', isInternetReachable: true },
  screen: { width: 390, height: 844 },
});

export const E2E_FIXTURE_DEVICE_INFO_JSON = JSON.stringify({
  fixtureVersion: E2E_NATIVE_TOOL_FIXTURE_VERSION,
  brand: 'Kavi Fixture',
  modelName: 'Deterministic Mobile Device',
  osName: 'fixture-os',
  osVersion: '1',
  totalMemory: 8_000_000_000,
  isDevice: true,
  platform: 'fixture',
});

export const E2E_FIXTURE_DEVICE_HEALTH_JSON = JSON.stringify({
  schemaVersion: 1,
  collectedAt: 1_000,
  memory: { systemTotalBytes: 8_000_000_000, appLimitBytes: 2_000_000_000 },
  storage: {
    totalBytes: 128_000_000_000,
    availableBytes: 64_000_000_000,
    usedBytes: 64_000_000_000,
  },
  battery: { levelPercent: 72 },
  runtime: { uptimeMs: 50_000 },
  observedMetricCount: 6,
});
