export async function executeDeviceStatus(): Promise<string> {
  try {
    const Battery = await import('expo-battery');
    const Network = await import('expo-network');
    const { Dimensions } = await import('react-native');

    const [batteryLevel, batteryState, networkState] = await Promise.all([
      Battery.getBatteryLevelAsync().catch(() => -1),
      Battery.getBatteryStateAsync().catch(() => 0),
      Network.getNetworkStateAsync().catch(() => ({})),
    ]);

    const screen = Dimensions.get('window');
    const batteryStateNames: Record<number, string> = {
      0: 'unknown',
      1: 'unplugged',
      2: 'charging',
      3: 'full',
    };

    return JSON.stringify({
      battery: {
        level: Math.round((batteryLevel as number) * 100),
        state: batteryStateNames[batteryState as number] || 'unknown',
      },
      network: {
        isConnected: (networkState as any).isConnected,
        type: (networkState as any).type,
        isInternetReachable: (networkState as any).isInternetReachable,
      },
      screen: { width: screen.width, height: screen.height },
    });
  } catch (err: unknown) {
    return JSON.stringify({
      error: `Device status failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ── Device Info Tool ─────────────────────────────────────────────────────

export async function executeDeviceInfo(): Promise<string> {
  try {
    const Device = await import('expo-device');
    const { Platform } = await import('react-native');

    return JSON.stringify({
      brand: Device.brand,
      modelName: Device.modelName,
      designName: Device.designName,
      osName: Device.osName,
      osVersion: Device.osVersion,
      platformApiLevel: Device.platformApiLevel,
      totalMemory: Device.totalMemory,
      deviceType: Device.deviceType,
      isDevice: Device.isDevice,
      platform: Platform.OS,
    });
  } catch (err: unknown) {
    return JSON.stringify({
      error: `Device info failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ── Device Permissions Tool ──────────────────────────────────────────────

export async function executeDevicePermissions(): Promise<string> {
  const permissions: Record<string, string> = {};

  try {
    const Calendar = await import('expo-calendar');
    const calPerm = await Calendar.getCalendarPermissionsAsync();
    permissions.calendar = calPerm.status;
  } catch {
    permissions.calendar = 'unavailable';
  }

  try {
    const Contacts = await import('expo-contacts');
    const contactPerm = await Contacts.getPermissionsAsync();
    permissions.contacts = contactPerm.status;
  } catch {
    permissions.contacts = 'unavailable';
  }

  try {
    const Location = await import('expo-location');
    const locPerm = await Location.getForegroundPermissionsAsync();
    permissions.location = locPerm.status;
  } catch {
    permissions.location = 'unavailable';
  }

  try {
    const ImagePicker = await import('expo-image-picker');
    const cameraPerm = await ImagePicker.getCameraPermissionsAsync();
    permissions.camera = cameraPerm.status;
    const mediaPerm = await ImagePicker.getMediaLibraryPermissionsAsync();
    permissions.mediaLibrary = mediaPerm.status;
  } catch {
    permissions.camera = 'unavailable';
    permissions.mediaLibrary = 'unavailable';
  }

  try {
    const { getRecordingPermissionsAsync } = await import('expo-audio');
    const audioPerm = await getRecordingPermissionsAsync();
    permissions.microphone = audioPerm.status;
  } catch {
    permissions.microphone = 'unavailable';
  }

  return JSON.stringify(permissions);
}

// ── Device Health Tool ───────────────────────────────────────────────────

export async function executeDeviceHealth(): Promise<string> {
  try {
    const Device = await import('expo-device');
    const Battery = await import('expo-battery');
    const { Paths } = await import('expo-file-system');

    const batteryLevel = await Battery.getBatteryLevelAsync().catch(() => -1);
    const uptime = Device.getUptimeAsync ? await Device.getUptimeAsync().catch(() => -1) : -1;

    return JSON.stringify({
      totalMemory: Device.totalMemory,
      batteryLevel: Math.round((batteryLevel as number) * 100),
      isDevice: Device.isDevice,
      supportedCpuArchitectures: Device.supportedCpuArchitectures,
      uptime,
      documentsDir: Paths.document?.uri,
    });
  } catch (err: unknown) {
    return JSON.stringify({
      error: `Device health check failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
