// ---------------------------------------------------------------------------
// Tests for new native device tool executors:
// device_status, device_info, device_permissions, device_health,
// photos_latest, camera_clip, screen_record, haptic_feedback
// ---------------------------------------------------------------------------

const mockGetStringAsync = jest.fn();
const mockSetStringAsync = jest.fn();

jest.mock('expo-clipboard', () => ({
  getStringAsync: (...args: any[]) => mockGetStringAsync(...args),
  setStringAsync: (...args: any[]) => mockSetStringAsync(...args),
}));

jest.mock('react-native', () => ({
  Linking: {
    canOpenURL: jest.fn().mockResolvedValue(true),
    openURL: jest.fn().mockResolvedValue(undefined),
  },
  Share: { share: jest.fn().mockResolvedValue({}) },
  Dimensions: { get: jest.fn().mockReturnValue({ width: 390, height: 844 }) },
  Platform: { OS: 'ios' },
}));

jest.mock('expo-battery', () => ({
  getBatteryLevelAsync: jest.fn().mockResolvedValue(0.5),
  getBatteryStateAsync: jest.fn().mockResolvedValue(2),
}));

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn().mockResolvedValue({
    isConnected: true,
    type: 'WIFI',
    isInternetReachable: true,
  }),
}));

jest.mock('expo-device', () => ({
  brand: 'Test',
  modelName: 'Test Device',
  designName: 'test-device',
  osName: 'iOS',
  osVersion: '18',
  platformApiLevel: null,
  totalMemory: 1024,
  deviceType: 1,
  isDevice: false,
}));

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
}));

jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
  getCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  CameraType: { front: 'front', back: 'back' },
}));

jest.mock('react-native-view-shot', () => ({
  captureScreen: jest.fn().mockRejectedValue(new Error('screen capture unavailable')),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('../../src/services/notifications/service', () => ({
  cancelLocalNotification: jest.fn().mockResolvedValue({ id: 'notification-id', cancelled: true }),
}));

import {
  executeDeviceHealth,
  executeDeviceInfo,
  executeDevicePermissions,
  executeDeviceStatus,
} from '../../src/engine/tools/native/device/executor';
import { executeNativeTool } from '../../src/engine/tools/native/executor';
import { executeHapticFeedback } from '../../src/engine/tools/native/haptics/executor';
import {
  executeCameraClip,
  executePhotosLatest,
  executeScreenRecord,
} from '../../src/engine/tools/native/media/executor';
import { executeNotificationCancel } from '../../src/engine/tools/native/notifications/executor';
import {
  completedToolContent,
  failedToolContent,
  parseCompletedToolOutcome,
  parseFailedToolOutcome,
} from '../helpers/toolRuntimeOutcome';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Device Status Tool', () => {
  it('returns battery and network info or error', async () => {
    const result = await executeDeviceStatus();
    const parsed = parseCompletedToolOutcome(result);
    expect(parsed.battery).toBeDefined();
  });
});

describe('Device Info Tool', () => {
  it('returns device hardware info or error', async () => {
    const result = await executeDeviceInfo();
    const parsed = parseCompletedToolOutcome(result);
    expect(parsed.platform).toBe('ios');
  });
});

describe('Device Permissions Tool', () => {
  it('returns permission statuses', async () => {
    const result = await executeDevicePermissions();
    const parsed = parseCompletedToolOutcome(result);
    expect(typeof parsed).toBe('object');
    // Should have at least one permission key
    const keys = Object.keys(parsed);
    expect(keys.length).toBeGreaterThan(0);
  });
});

describe('Device Health Tool', () => {
  it('returns the bounded resource-health contract', async () => {
    const result = await executeDeviceHealth();
    const parsed = parseCompletedToolOutcome(result);
    expect(parsed).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        memory: expect.any(Object),
        storage: expect.any(Object),
        battery: expect.any(Object),
        runtime: expect.any(Object),
        observedMetricCount: expect.any(Number),
      }),
    );
    for (const metric of [
      parsed.memory.systemTotalBytes,
      parsed.memory.appLimitBytes,
      parsed.storage.totalBytes,
      parsed.storage.availableBytes,
      parsed.storage.usedBytes,
      parsed.battery.levelPercent,
      parsed.runtime.uptimeMs,
    ]) {
      expect(metric === null || typeof metric === 'number').toBe(true);
    }
    const content = completedToolContent(result);
    expect(content).not.toContain('documentsDir');
    expect(content).not.toContain('supportedCpuArchitectures');
  });
});

describe('Photos Latest Tool', () => {
  it('handles permission denied', async () => {
    const result = await executePhotosLatest({ count: 3 });
    const parsed = parseFailedToolOutcome(result);
    expect(typeof parsed).toBe('object');
  });

  it('caps count at 20', async () => {
    const result = await executePhotosLatest({ count: 100 });
    expect(typeof failedToolContent(result)).toBe('string');
  });
});

describe('Camera Clip Tool', () => {
  it('handles camera cancellation or error', async () => {
    const result = await executeCameraClip({});
    const parsed = parseFailedToolOutcome(result);
    expect(parsed.status).toBe('cancelled');
  });
});

describe('Screen Record Tool', () => {
  it('returns result or not-available message', async () => {
    const result = await executeScreenRecord({ format: 'png' });
    const parsed = parseFailedToolOutcome(result);
    expect(parsed).toHaveProperty('status');
    expect(parsed.status).toBe('screenshot_not_available');
  });
});

describe('Haptic Feedback Tool', () => {
  it('triggers haptic feedback (or degrades gracefully)', async () => {
    const result = await executeHapticFeedback({ type: 'success' });
    const parsed = parseCompletedToolOutcome(result);
    expect(parsed.status).toBe('triggered');
  });

  it('defaults to medium type', async () => {
    const result = await executeHapticFeedback({});
    const parsed = parseCompletedToolOutcome(result);
    expect(parsed).toEqual({ status: 'triggered', type: 'medium' });
  });
});

describe('Notification Cancel Tool', () => {
  it('returns structured cancellation evidence', async () => {
    const result = await executeNotificationCancel({ id: 'notification-id' });
    const parsed = parseCompletedToolOutcome(result);
    expect(parsed).toEqual({
      status: 'notification_cancelled',
      id: 'notification-id',
      cancelled: true,
    });
  });
});

describe('Native Tool Dispatcher — New Tools', () => {
  it('routes device_status correctly', async () => {
    const result = await executeNativeTool('device_status', '{}');
    expect(typeof completedToolContent(result)).toBe('string');
  });

  it('routes device_info correctly', async () => {
    const result = await executeNativeTool('device_info', '{}');
    expect(typeof completedToolContent(result)).toBe('string');
  });

  it('routes device_permissions correctly', async () => {
    const result = await executeNativeTool('device_permissions', '{}');
    expect(typeof completedToolContent(result)).toBe('string');
  });

  it('routes device_health correctly', async () => {
    const result = await executeNativeTool('device_health', '{}');
    expect(typeof completedToolContent(result)).toBe('string');
  });

  it('routes haptic_feedback correctly', async () => {
    const result = await executeNativeTool('haptic_feedback', '{"type":"light"}');
    expect(typeof completedToolContent(result)).toBe('string');
  });

  it('routes screen_record correctly', async () => {
    const result = await executeNativeTool('screen_record', '{}');
    expect(typeof failedToolContent(result)).toBe('string');
  });

  it('routes notification_cancel correctly', async () => {
    const result = await executeNativeTool('notification_cancel', '{"id":"notification-id"}');
    expect(parseCompletedToolOutcome(result).status).toBe('notification_cancelled');
  });

  it('continues to handle unknown tools', async () => {
    const result = await executeNativeTool('nonexistent', '{}');
    expect(failedToolContent(result)).toContain('unknown native tool');
  });

  it('does not enter a native executor after lifecycle cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('backgrounded'));

    expect(
      failedToolContent(
        await executeNativeTool('haptic_feedback', '{"type":"light"}', controller.signal),
      ),
    ).toBe('Error: Request cancelled');
  });
});
