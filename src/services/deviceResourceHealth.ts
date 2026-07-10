export const DEVICE_RESOURCE_HEALTH_SCHEMA_VERSION = 1 as const;

export interface DeviceResourceHealthSnapshot {
  schemaVersion: typeof DEVICE_RESOURCE_HEALTH_SCHEMA_VERSION;
  collectedAt: number;
  memory: {
    systemTotalBytes: number | null;
    appLimitBytes: number | null;
  };
  storage: {
    totalBytes: number | null;
    availableBytes: number | null;
    usedBytes: number | null;
  };
  battery: {
    levelPercent: number | null;
  };
  runtime: {
    uptimeMs: number | null;
  };
  observedMetricCount: number;
}

interface DeviceResourceHealthDependencies {
  now(): number;
  loadDevice(): Promise<{
    totalMemory: number | null;
    getMaxMemoryAsync?: () => Promise<number>;
    getUptimeAsync?: () => Promise<number>;
  }>;
  loadBattery(): Promise<{
    getBatteryLevelAsync(): Promise<number>;
  }>;
  loadFileSystem(): Promise<{
    Paths: {
      totalDiskSpace: number;
      availableDiskSpace: number;
    };
  }>;
}

const DEFAULT_DEPENDENCIES: DeviceResourceHealthDependencies = {
  now: Date.now,
  loadDevice: () => import('expo-device'),
  loadBattery: () => import('expo-battery'),
  loadFileSystem: () => import('expo-file-system'),
};

function boundedInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

async function observeNumber(read: () => number | Promise<number>): Promise<number | null> {
  try {
    return boundedInteger(await read());
  } catch {
    return null;
  }
}

async function loadOrNull<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

/** Collects a fixed, privacy-bounded snapshot. Null means the platform did not expose a metric. */
export async function collectDeviceResourceHealth(
  dependencies: DeviceResourceHealthDependencies = DEFAULT_DEPENDENCIES,
): Promise<DeviceResourceHealthSnapshot> {
  const collectedAt = dependencies.now();
  if (!Number.isSafeInteger(collectedAt) || collectedAt < 0) {
    throw new Error('device_resource_health_clock_invalid');
  }

  const [device, battery, fileSystem] = await Promise.all([
    loadOrNull(dependencies.loadDevice),
    loadOrNull(dependencies.loadBattery),
    loadOrNull(dependencies.loadFileSystem),
  ]);
  const systemTotalBytes = boundedInteger(device?.totalMemory);
  const appLimitBytes = device?.getMaxMemoryAsync
    ? await observeNumber(device.getMaxMemoryAsync)
    : null;
  const uptimeMs = device?.getUptimeAsync ? await observeNumber(device.getUptimeAsync) : null;
  const totalBytes = fileSystem ? await observeNumber(() => fileSystem.Paths.totalDiskSpace) : null;
  const observedAvailableBytes = fileSystem
    ? await observeNumber(() => fileSystem.Paths.availableDiskSpace)
    : null;
  const availableBytes =
    totalBytes !== null && observedAvailableBytes !== null && observedAvailableBytes <= totalBytes
      ? observedAvailableBytes
      : null;
  const usedBytes =
    totalBytes !== null && availableBytes !== null ? totalBytes - availableBytes : null;
  let levelPercent: number | null = null;
  if (battery) {
    try {
      const level = await battery.getBatteryLevelAsync();
      if (typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 1) {
        levelPercent = Math.round(level * 100);
      }
    } catch {
      // The remaining metrics are still valid evidence.
    }
  }
  const observedMetricCount = [
    systemTotalBytes,
    appLimitBytes,
    totalBytes,
    availableBytes,
    levelPercent,
    uptimeMs,
  ].filter((value) => value !== null).length;

  return {
    schemaVersion: DEVICE_RESOURCE_HEALTH_SCHEMA_VERSION,
    collectedAt,
    memory: { systemTotalBytes, appLimitBytes },
    storage: { totalBytes, availableBytes, usedBytes },
    battery: { levelPercent },
    runtime: { uptimeMs },
    observedMetricCount,
  };
}
