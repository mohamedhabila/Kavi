import { NativeModules, Platform } from 'react-native';
import { executeNotificationsRead } from '../../src/engine/tools/native/notifications/executor';
import { NOTIFICATION_ACCESS } from '../../src/screens/settings/systemAccesses';
import {
  getNotificationAccessState,
  openNotificationAccessSettings,
  readRecentNotifications,
} from '../../src/services/notifications/notificationReader';

const originalOS = Platform.OS;
const mockReader = {
  getAccessState: jest.fn(),
  openAccessSettings: jest.fn(),
  readRecent: jest.fn(),
};

function setPlatform(os: string): void {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

const POSTED_AT = Date.UTC(2026, 9, 15, 9, 30);

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('android');
  NativeModules.KaviNotificationReader = mockReader;
  mockReader.getAccessState.mockResolvedValue('granted');
  mockReader.openAccessSettings.mockResolvedValue(true);
  mockReader.readRecent.mockResolvedValue({
    access: 'granted',
    notifications: [
      {
        id: '0|com.example.sms|7|ana|10001',
        app: 'Messages',
        packageName: 'com.example.sms',
        title: 'Ana',
        text: 'Running 10 minutes late',
        postedAt: POSTED_AT,
        showing: true,
        canReply: true,
      },
    ],
  });
});

afterEach(() => {
  setPlatform(originalOS);
  delete NativeModules.KaviNotificationReader;
  jest.restoreAllMocks();
});

describe('notification reader', () => {
  it('reads access and recent notifications through the native module', async () => {
    await expect(getNotificationAccessState()).resolves.toBe('granted');
    await expect(openNotificationAccessSettings()).resolves.toBe(true);
    await expect(readRecentNotifications(1_000, 5)).resolves.toEqual({
      access: 'granted',
      notifications: [expect.objectContaining({ title: 'Ana' })],
    });
    expect(mockReader.readRecent).toHaveBeenCalledWith(1_000, 5);
  });

  it('is unavailable on iOS, which lets no app read other apps notifications', async () => {
    setPlatform('ios');

    await expect(getNotificationAccessState()).resolves.toBe('unavailable');
    await expect(openNotificationAccessSettings()).resolves.toBe(false);
    await expect(readRecentNotifications(0, 5)).resolves.toEqual({
      access: 'unavailable',
      notifications: [],
    });
    expect(mockReader.readRecent).not.toHaveBeenCalled();
  });

  it.each([
    ['granted', 'held'],
    ['not_granted', 'not_held'],
  ])('shows %s access as %s in settings', async (native, shown) => {
    mockReader.getAccessState.mockResolvedValueOnce(native);
    await expect(NOTIFICATION_ACCESS.readState()).resolves.toBe(shown);
  });
});

describe('notifications_read', () => {
  it('returns the recent notifications, newest first, within bounded arguments', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(POSTED_AT + 60_000);

    const outcome = await executeNotificationsRead({ since_minutes: 99_999, limit: 500 });

    expect(outcome.status).toBe('completed');
    expect(JSON.parse(outcome.content)).toEqual({
      status: 'completed',
      since: new Date(POSTED_AT + 60_000 - 7 * 24 * 60 * 60_000).toISOString(),
      count: 1,
      notifications: [
        {
          id: '0|com.example.sms|7|ana|10001',
          app: 'Messages',
          title: 'Ana',
          text: 'Running 10 minutes late',
          postedAt: new Date(POSTED_AT).toISOString(),
          showing: true,
          canReply: true,
        },
      ],
    });
    expect(mockReader.readRecent).toHaveBeenCalledWith(expect.any(Number), 100);
  });

  it('looks back a day and returns thirty by default', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(POSTED_AT);

    await executeNotificationsRead(undefined);

    expect(mockReader.readRecent).toHaveBeenCalledWith(POSTED_AT - 24 * 60 * 60_000, 30);
  });

  it('says how to turn access on when it is off', async () => {
    mockReader.readRecent.mockResolvedValueOnce({ access: 'not_granted', notifications: [] });

    const outcome = await executeNotificationsRead({});

    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'permission' });
    expect(JSON.parse(outcome.content)).toMatchObject({ code: 'permission_denied' });
  });

  it('reports that iOS cannot read notifications', async () => {
    setPlatform('ios');

    const outcome = await executeNotificationsRead({});

    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'unavailable' });
    expect(JSON.parse(outcome.content)).toMatchObject({ code: 'platform_unavailable' });
  });
});
