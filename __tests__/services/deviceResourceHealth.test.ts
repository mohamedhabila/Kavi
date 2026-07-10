import { collectDeviceResourceHealth } from '../../src/services/deviceResourceHealth';

type ResourceHealthDependencies = NonNullable<Parameters<typeof collectDeviceResourceHealth>[0]>;

function dependencies(
  overrides: Partial<ResourceHealthDependencies> = {},
): ResourceHealthDependencies {
  return {
    now: () => 1_000,
    loadDevice: async () => ({
      totalMemory: 8_000,
      getMaxMemoryAsync: async () => 2_000,
      getUptimeAsync: async () => 50_000,
    }),
    loadBattery: async () => ({ getBatteryLevelAsync: async () => 0.625 }),
    loadFileSystem: async () => ({
      Paths: { totalDiskSpace: 10_000, availableDiskSpace: 4_000 },
    }),
    ...overrides,
  };
}

describe('device resource health', () => {
  it('returns a fixed bounded snapshot from observed platform metrics', async () => {
    await expect(collectDeviceResourceHealth(dependencies())).resolves.toEqual({
      schemaVersion: 1,
      collectedAt: 1_000,
      memory: { systemTotalBytes: 8_000, appLimitBytes: 2_000 },
      storage: { totalBytes: 10_000, availableBytes: 4_000, usedBytes: 6_000 },
      battery: { levelPercent: 63 },
      runtime: { uptimeMs: 50_000 },
      observedMetricCount: 6,
    });
  });

  it('keeps partial evidence and suppresses platform error details', async () => {
    const snapshot = await collectDeviceResourceHealth(
      dependencies({
        loadDevice: async () => {
          throw new Error('private native detail');
        },
        loadBattery: async () => ({
          getBatteryLevelAsync: async () => {
            throw new Error('battery unavailable');
          },
        }),
      }),
    );

    expect(snapshot).toEqual({
      schemaVersion: 1,
      collectedAt: 1_000,
      memory: { systemTotalBytes: null, appLimitBytes: null },
      storage: { totalBytes: 10_000, availableBytes: 4_000, usedBytes: 6_000 },
      battery: { levelPercent: null },
      runtime: { uptimeMs: null },
      observedMetricCount: 2,
    });
    expect(JSON.stringify(snapshot)).not.toContain('private native detail');
  });

  it.each([
    {
      label: 'negative battery sentinel',
      overrides: {
        loadBattery: async () => ({ getBatteryLevelAsync: async () => -1 }),
      },
      path: (snapshot: Awaited<ReturnType<typeof collectDeviceResourceHealth>>) =>
        snapshot.battery.levelPercent,
    },
    {
      label: 'inconsistent storage availability',
      overrides: {
        loadFileSystem: async () => ({
          Paths: { totalDiskSpace: 100, availableDiskSpace: 101 },
        }),
      },
      path: (snapshot: Awaited<ReturnType<typeof collectDeviceResourceHealth>>) =>
        snapshot.storage.availableBytes,
    },
    {
      label: 'unsafe memory integer',
      overrides: {
        loadDevice: async () => ({ totalMemory: Number.MAX_VALUE }),
      },
      path: (snapshot: Awaited<ReturnType<typeof collectDeviceResourceHealth>>) =>
        snapshot.memory.systemTotalBytes,
    },
  ])('marks $label unavailable instead of emitting false evidence', async ({ overrides, path }) => {
    const snapshot = await collectDeviceResourceHealth(dependencies(overrides));
    expect(path(snapshot)).toBeNull();
  });

  it('rejects a malformed code-owned clock', async () => {
    await expect(
      collectDeviceResourceHealth(dependencies({ now: () => Number.NaN })),
    ).rejects.toThrow('device_resource_health_clock_invalid');
  });
});
