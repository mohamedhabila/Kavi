const { spawnSync } = require('child_process');

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: options.env || process.env,
  });
}

function parseAdbDevices(output) {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices'))
    .map((line) => {
      const [deviceId, state] = line.split(/\s+/u);
      return { deviceId, state };
    })
    .filter((device) => device.deviceId);
}

function probeAndroidDevice(config, options = {}) {
  const run = options.runCommand || runCommand;
  const adb = options.adbCommand || 'adb';
  const devicesResult = run(adb, ['devices', '-l'], { cwd: config.projectRoot });
  if (devicesResult.status !== 0) {
    return {
      ok: false,
      reason: 'adb_unavailable',
      detail: devicesResult.stderr?.trim() || devicesResult.stdout?.trim(),
    };
  }

  const devices = parseAdbDevices(devicesResult.stdout || '');
  const onlineDevices = devices.filter((device) => device.state === 'device');
  const configuredDeviceId = config.device.deviceId;
  const selectedDevice = configuredDeviceId
    ? onlineDevices.find((device) => device.deviceId === configuredDeviceId)
    : onlineDevices[0];

  if (!selectedDevice) {
    return {
      ok: false,
      reason: configuredDeviceId ? 'configured_device_not_online' : 'no_online_android_device',
      devices,
    };
  }

  const packageResult = run(
    adb,
    ['-s', selectedDevice.deviceId, 'shell', 'pm', 'path', config.appId],
    { cwd: config.projectRoot },
  );
  if (packageResult.status !== 0 || !packageResult.stdout?.includes('package:')) {
    return {
      ok: false,
      reason: 'app_not_installed',
      deviceId: selectedDevice.deviceId,
      appId: config.appId,
      detail: packageResult.stderr?.trim() || packageResult.stdout?.trim(),
    };
  }

  return {
    ok: true,
    platform: 'android',
    deviceId: selectedDevice.deviceId,
    appId: config.appId,
  };
}

function probeDevice(config, options = {}) {
  if (config.skipDeviceProbe) {
    return {
      ok: true,
      platform: config.platform,
      deviceId: config.device.deviceId || 'external-driver',
      appId: config.appId,
      skippedProbe: true,
    };
  }

  if (config.platform === 'android') {
    return probeAndroidDevice(config, options);
  }

  if (!config.device.deviceId) {
    return {
      ok: false,
      reason: 'ios_device_id_required',
    };
  }

  return {
    ok: true,
    platform: 'ios',
    deviceId: config.device.deviceId,
    appId: config.appId,
  };
}

module.exports = {
  parseAdbDevices,
  probeAndroidDevice,
  probeDevice,
};
