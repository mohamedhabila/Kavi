import * as Notifications from 'expo-notifications';
import {
  cancelReminderNotifications,
  scheduleReminderNotifications,
} from '../../src/services/scheduler/reminders/notificationScheduling';

describe('reminder notification scheduling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(
      async (request: { identifier?: string }) => request.identifier ?? 'generated-id',
    );
    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('schedules a DATE trigger for a "once" reminder and reports armedForMs', async () => {
    const result = await scheduleReminderNotifications(
      { id: 'r1', title: 'Call mom', notes: 'weekend plans', recurrence: { kind: 'once', at: '2026-09-10T18:00:00-04:00' }, timezone: 'America/New_York' },
      1_800_000_000_000,
    );
    expect(result.notificationIds).toEqual(['reminder-r1']);
    expect(result.armedForMs).toBe(1_800_000_000_000);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'reminder-r1',
        content: expect.objectContaining({ title: 'Call mom', body: 'weekend plans' }),
        trigger: expect.objectContaining({
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: 1_800_000_000_000,
        }),
      }),
    );
  });

  it('schedules a DATE trigger for a "monthly" reminder', async () => {
    const result = await scheduleReminderNotifications(
      { id: 'r2', title: 'Pay rent', notes: undefined, recurrence: { kind: 'monthly', time: '09:00', dayOfMonth: 1 }, timezone: 'UTC' },
      1_800_000_000_000,
    );
    expect(result.notificationIds).toEqual(['reminder-r2']);
    expect(result.armedForMs).toBe(1_800_000_000_000);
  });

  it('throws when once/monthly is scheduled without a next fire time', async () => {
    await expect(
      scheduleReminderNotifications(
        { id: 'r3', title: 'x', notes: undefined, recurrence: { kind: 'once', at: '2020-01-01T00:00:00Z' }, timezone: 'UTC' },
        undefined,
      ),
    ).rejects.toThrow(/no future occurrence/);
  });

  it('schedules a native DAILY trigger', async () => {
    const result = await scheduleReminderNotifications(
      { id: 'r4', title: 'Standup', notes: undefined, recurrence: { kind: 'daily', time: '09:05' }, timezone: 'UTC' },
      undefined,
    );
    expect(result.notificationIds).toEqual(['reminder-r4']);
    expect(result.armedForMs).toBeUndefined();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: expect.objectContaining({
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: 9,
          minute: 5,
        }),
      }),
    );
  });

  it('schedules a native WEEKLY trigger using the Apple weekday convention', async () => {
    // ISO weekday 3 = Wednesday -> Apple weekday 4.
    await scheduleReminderNotifications(
      { id: 'r5', title: 'Team sync', notes: undefined, recurrence: { kind: 'weekly', time: '14:00', weekday: 3 }, timezone: 'UTC' },
      undefined,
    );
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: expect.objectContaining({
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: 4,
          hour: 14,
          minute: 0,
        }),
      }),
    );
  });

  it('schedules five WEEKLY triggers (Mon-Fri) for "weekdays"', async () => {
    const result = await scheduleReminderNotifications(
      { id: 'r6', title: 'Standup', notes: undefined, recurrence: { kind: 'weekdays', time: '09:00' }, timezone: 'UTC' },
      undefined,
    );
    expect(result.notificationIds).toEqual([
      'reminder-r6-dow-1',
      'reminder-r6-dow-2',
      'reminder-r6-dow-3',
      'reminder-r6-dow-4',
      'reminder-r6-dow-5',
    ]);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(5);
    const weekdaysUsed = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.map(
      ([request]) => request.trigger.weekday,
    );
    // ISO Mon..Fri (1..5) -> Apple weekday 2..6.
    expect(weekdaysUsed).toEqual([2, 3, 4, 5, 6]);
  });

  it('cancels every notification id for a reminder', async () => {
    await cancelReminderNotifications(['a', 'b', 'c']);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(3);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('a');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('b');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('c');
  });

  it('is a no-op when there are no notification ids', async () => {
    await cancelReminderNotifications([]);
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('aggregates and throws when some cancellations fail', async () => {
    (Notifications.cancelScheduledNotificationAsync as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    await expect(cancelReminderNotifications(['a', 'b', 'c'])).rejects.toThrow(
      /Failed to cancel 1 of 3/,
    );
    // Every id is still attempted even though one fails.
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(3);
  });
});
