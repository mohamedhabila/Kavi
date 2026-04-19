import * as Notifications from 'expo-notifications';
import {
  getPendingNotificationRoute,
  initializeNotifications,
  sendLocalNotification,
  subscribeToNotificationRoutes,
} from '../../src/services/notifications/service';

describe('notifications service', () => {
  const mockSubscriptionRemove = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
      status: 'granted',
    });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
      status: 'granted',
    });
    (Notifications.scheduleNotificationAsync as jest.Mock).mockResolvedValue('notification-id');
    (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockReturnValue({
      remove: mockSubscriptionRemove,
    });
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(null);
  });

  it('initializes notification handler and channel', async () => {
    await initializeNotifications();

    expect(Notifications.setNotificationHandler).toHaveBeenCalledTimes(1);
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('sends an immediate local notification', async () => {
    const result = await sendLocalNotification({ title: 'Hello', body: 'World' });

    expect(result).toEqual({ id: 'notification-id', scheduled: false });
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: expect.objectContaining({ title: 'Hello', body: 'World', sound: true }),
      trigger: null,
    });
  });

  it('includes deep-link metadata in notification payloads', async () => {
    await sendLocalNotification({
      title: 'Task done',
      body: 'Open the thread',
      data: { screen: 'Chat', conversationId: 'conv-1', source: 'scheduled_task' },
    });

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: expect.objectContaining({
        data: { screen: 'Chat', conversationId: 'conv-1', source: 'scheduled_task' },
      }),
      trigger: null,
    });
  });

  it('schedules a delayed local notification', async () => {
    const result = await sendLocalNotification({ title: 'Hello', body: 'Later', delaySeconds: 90 });

    expect(result).toEqual({ id: 'notification-id', scheduled: true });
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: expect.objectContaining({ title: 'Hello', body: 'Later', sound: true }),
      trigger: expect.objectContaining({
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 90,
        channelId: 'kavi-default',
      }),
    });
  });

  it('uses boolean default sound to avoid Android Uri serialization issues', async () => {
    await sendLocalNotification({ title: 'Reminder', body: 'Ping', delaySeconds: 5 });

    const request = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(request.content.sound).toBe(true);
    expect(request.content.sound).not.toBe('default');
  });

  it('requests permissions when not already granted', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      status: 'denied',
    });

    await sendLocalNotification({ title: 'Hello', body: 'World' });

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
  });

  it('throws when notification permission is denied', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      status: 'denied',
    });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      status: 'denied',
    });

    await expect(sendLocalNotification({ title: 'Denied', body: 'Nope' })).rejects.toThrow(
      'Notification permission denied',
    );
  });

  it('subscribes to notification tap routes and filters by default action', () => {
    const listener = jest.fn();
    subscribeToNotificationRoutes(listener);

    const handler = (Notifications.addNotificationResponseReceivedListener as jest.Mock).mock
      .calls[0][0];
    handler({
      actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
      notification: {
        request: {
          identifier: 'notif-1',
          content: {
            data: { screen: 'Chat', conversationId: 'conv-42', source: 'scheduled_task' },
          },
        },
      },
    });

    expect(listener).toHaveBeenCalledWith({
      screen: 'Chat',
      conversationId: 'conv-42',
      source: 'scheduled_task',
    });
  });

  it('reads and clears the pending notification route once', async () => {
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValueOnce({
      actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
      notification: {
        request: {
          identifier: 'notif-2',
          content: {
            data: { conversationId: 'conv-77', source: 'scheduled_task' },
          },
        },
      },
    });

    await expect(getPendingNotificationRoute()).resolves.toEqual({
      screen: 'Chat',
      conversationId: 'conv-77',
      source: 'scheduled_task',
    });
    expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
  });
});
