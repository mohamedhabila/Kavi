// ---------------------------------------------------------------------------
// Tests for new native device tool executors:
// device_status, device_info, device_permissions, device_health,
// photos_pick, camera_clip, screen_record, haptic_feedback
// ---------------------------------------------------------------------------

const mockGetStringAsync = jest.fn();
const mockSetStringAsync = jest.fn();
const mockLaunchImageLibraryAsync = jest
  .fn()
  .mockResolvedValue({ canceled: true, assets: [] });

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

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: any[]) => mockLaunchImageLibraryAsync(...args),
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
  normalizeDeviceBatteryEvidence,
} from '../../src/engine/tools/native/device/executor';
import { executeNativeTool } from '../../src/engine/tools/native/executor';
import { executeHapticFeedback } from '../../src/engine/tools/native/haptics/executor';
import {
  executeCameraClip,
  executePhotosPick,
  executeScreenRecord,
} from '../../src/engine/tools/native/media/executor';
import { executeNotificationCancel } from '../../src/engine/tools/native/notifications/executor';
import {
  completedToolContent,
  failedToolContent,
  parseCompletedToolOutcome,
  parseFailedToolOutcome,
} from '../helpers/toolRuntimeOutcome';
import type { ToolRuntimeOutcome } from '../../src/types/toolRuntimeOutcome';

function expectNativeCompletionOrFailure(
  outcome: ToolRuntimeOutcome,
  assertCompletedPayload: (payload: Record<string, unknown>) => void,
): void {
  const payload = JSON.parse(outcome.content) as Record<string, unknown>;
  if (outcome.status === 'completed') {
    assertCompletedPayload(payload);
    return;
  }

  expect(payload).toEqual({ error: expect.any(String) });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Device Status Tool', () => {
  it('returns explicit available battery and network evidence', async () => {
    const result = await executeDeviceStatus();
    expectNativeCompletionOrFailure(result, (parsed) => {
      expect(parsed.battery).toEqual({ available: true, level: 50, state: 'charging' });
    });
  });

  it('represents an unavailable battery without a false negative percentage', () => {
    expect(normalizeDeviceBatteryEvidence(-1, 0)).toEqual({
      available: false,
      level: null,
      state: 'unknown',
    });
  });
});

describe('Device Info Tool', () => {
  it('returns device hardware info or error', async () => {
    const result = await executeDeviceInfo();
    expectNativeCompletionOrFailure(result, (parsed) => {
      expect(parsed.platform).toBe('ios');
    });
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

describe('Photos Pick Tool', () => {
  it('reports picker cancellation without claiming photo selection', async () => {
    const result = await executePhotosPick({ count: 3 });
    const parsed = parseFailedToolOutcome(result);
    expect(parsed).toEqual({ status: 'cancelled' });
  });

  it('caps user selection at 20 and returns only selected metadata', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: Array.from({ length: 25 }, (_, index) => ({
        assetId: `asset-${index}`,
        uri: `file:///photo-${index}.jpg`,
        fileName: `photo-${index}.jpg`,
        fileSize: 1000 + index,
        width: 100,
        height: 200,
        mimeType: 'image/jpeg',
      })),
    });

    const result = await executePhotosPick({ count: 100 });

    expect(mockLaunchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 20,
      quality: 1,
    });
    const parsed = parseCompletedToolOutcome(result);
    expect(parsed.status).toBe('selected');
    expect(parsed.assets).toHaveLength(20);
    expect(parsed.assets[0]).toEqual({
      assetId: 'asset-0',
      uri: 'file:///photo-0.jpg',
      fileName: 'photo-0.jpg',
      fileSize: 1000,
      width: 100,
      height: 200,
      mimeType: 'image/jpeg',
    });
  });
});

describe('Camera Clip Tool', () => {
  it('handles camera cancellation or error', async () => {
    const result = await executeCameraClip({});
    const parsed = parseFailedToolOutcome(result);
    if (parsed.status === 'cancelled') {
      expect(parsed).toEqual({ status: 'cancelled' });
    } else {
      expect(parsed).toEqual({ error: expect.any(String) });
    }
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
    expectNativeCompletionOrFailure(result, (parsed) => {
      expect(parsed).toEqual({ status: 'triggered', type: 'success' });
    });
  });

  it('defaults to medium type', async () => {
    const result = await executeHapticFeedback({});
    expectNativeCompletionOrFailure(result, (parsed) => {
      expect(parsed).toEqual({ status: 'triggered', type: 'medium' });
    });
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
    expectNativeCompletionOrFailure(result, (parsed) => {
      expect(parsed.battery).toBeDefined();
    });
  });

  it('routes device_info correctly', async () => {
    const result = await executeNativeTool('device_info', '{}');
    expectNativeCompletionOrFailure(result, (parsed) => {
      expect(parsed.platform).toBe('ios');
    });
  });

  it('routes device_permissions correctly', async () => {
    const result = await executeNativeTool('device_permissions', '{}');
    expect(typeof completedToolContent(result)).toBe('string');
  });

  it('routes device_health correctly', async () => {
    const result = await executeNativeTool('device_health', '{}');
    expect(typeof completedToolContent(result)).toBe('string');
  });

  it('defaults the canonical device query to status', async () => {
    const result = await executeNativeTool('device_query', '{}');
    expectNativeCompletionOrFailure(result, (parsed) => {
      expect(parsed.battery).toBeDefined();
      expect(parsed.network).toBeDefined();
    });
  });

  it('routes haptic_feedback correctly', async () => {
    const result = await executeNativeTool('haptic_feedback', '{"type":"light"}');
    expectNativeCompletionOrFailure(result, (parsed) => {
      expect(parsed).toEqual({ status: 'triggered', type: 'light' });
    });
  });

  it('routes screen_record correctly', async () => {
    const result = await executeNativeTool('screen_record', '{}');
    expect(typeof failedToolContent(result)).toBe('string');
  });

  it('routes photos_pick through the system picker', async () => {
    const result = await executeNativeTool('photos_pick', '{"count":1}');
    expect(parseFailedToolOutcome(result)).toEqual({ status: 'cancelled' });
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
