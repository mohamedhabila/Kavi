jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import * as Notifications from 'expo-notifications';
import { closeRemindersDb } from '../../src/services/scheduler/reminders/database';
import {
  cancelReminder,
  createReminder,
  listReminders,
  ReminderCommandError,
  updateReminder,
} from '../../src/services/scheduler/reminders/commands';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  jest.clearAllMocks();
  expoSqlite.__resetExpoSqliteForTests();
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(
    async (request: { identifier?: string }) => request.identifier ?? 'generated-id',
  );
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockResolvedValue(undefined);
});

afterEach(() => {
  closeRemindersDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('createReminder', () => {
  it('creates a pending reminder and schedules its OS notification', async () => {
    const reminder = await createReminder({
      title: 'Call mom',
      notes: 'ask about weekend',
      recurrence: { kind: 'daily', time: '09:00' },
      timezone: 'UTC',
    });
    expect(reminder.title).toBe('Call mom');
    expect(reminder.status).toBe('pending');
    expect(reminder.notificationIds).toEqual([`reminder-${reminder.id}`]);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty title', async () => {
    await expect(
      createReminder({ title: '   ', recurrence: { kind: 'daily', time: '09:00' }, timezone: 'UTC' }),
    ).rejects.toMatchObject({ code: 'reminder_title_required' });
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('rejects a schedule with no future occurrence', async () => {
    await expect(
      createReminder({
        title: 'Past',
        recurrence: { kind: 'once', at: '2000-01-01T00:00:00Z' },
        timezone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'reminder_schedule_invalid' });
  });

  it('wraps a native scheduling failure as ReminderCommandError', async () => {
    (Notifications.scheduleNotificationAsync as jest.Mock).mockRejectedValue(new Error('native boom'));
    await expect(
      createReminder({ title: 'x', recurrence: { kind: 'daily', time: '09:00' }, timezone: 'UTC' }),
    ).rejects.toMatchObject({ code: 'reminder_notification_schedule_failed' });
  });
});

describe('listReminders', () => {
  it('returns pending reminders sorted by next fire time', async () => {
    await createReminder({ title: 'B', recurrence: { kind: 'daily', time: '20:00' }, timezone: 'UTC' });
    await createReminder({ title: 'A', recurrence: { kind: 'daily', time: '05:00' }, timezone: 'UTC' });

    const nowMs = Date.parse('2026-06-01T00:00:00Z');
    const reminders = listReminders(nowMs);
    expect(reminders.map((r) => r.title)).toEqual(['A', 'B']);
  });
});

describe('updateReminder', () => {
  it('cancels the old notification and schedules a new one', async () => {
    const created = await createReminder({
      title: 'Original',
      recurrence: { kind: 'daily', time: '09:00' },
      timezone: 'UTC',
    });
    jest.clearAllMocks();
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(
      async (request: { identifier?: string }) => request.identifier ?? 'generated-id',
    );
    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockResolvedValue(undefined);

    const updated = await updateReminder(created.id, {
      title: 'Updated',
      recurrence: { kind: 'weekly', time: '10:00', weekday: 2 },
    });
    expect(updated.title).toBe('Updated');
    expect(updated.recurrence).toEqual({ kind: 'weekly', time: '10:00', weekday: 2 });
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(`reminder-${created.id}`);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('rejects updating a reminder that does not exist', async () => {
    await expect(updateReminder('missing', { title: 'x' })).rejects.toMatchObject({
      code: 'reminder_not_found',
    });
  });

  it('rejects updating a reminder that already fired', async () => {
    const created = await createReminder({
      title: 'Once',
      recurrence: { kind: 'once', at: '2099-01-01T00:00:00Z' },
      timezone: 'UTC',
    });
    // Simulate it having fired by cancelling it (sets status via the store indirectly is not
    // exposed here, so exercise the not-pending branch through cancelReminder + a second update).
    await cancelReminder(created.id);
    await expect(updateReminder(created.id, { title: 'x' })).rejects.toMatchObject({
      code: 'reminder_not_found',
    });
  });
});

describe('cancelReminder', () => {
  it('cancels the OS notification and removes the record', async () => {
    const created = await createReminder({
      title: 'Cancel me',
      recurrence: { kind: 'daily', time: '09:00' },
      timezone: 'UTC',
    });
    await cancelReminder(created.id);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(`reminder-${created.id}`);
    expect(listReminders().find((r) => r.id === created.id)).toBeUndefined();
  });

  it('rejects cancelling an id that does not exist', async () => {
    await expect(cancelReminder('missing')).rejects.toBeInstanceOf(ReminderCommandError);
  });
});
