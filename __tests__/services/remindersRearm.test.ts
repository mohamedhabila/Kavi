jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import * as Notifications from 'expo-notifications';
import { closeRemindersDb } from '../../src/services/scheduler/reminders/database';
import { getReminder, insertReminder } from '../../src/services/scheduler/reminders/store';
import { reconcilePendingReminders } from '../../src/services/scheduler/reminders/rearm';

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

describe('reconcilePendingReminders', () => {
  it('marks an elapsed "once" reminder as fired', async () => {
    const nowMs = Date.parse('2026-06-02T00:00:00Z');
    insertReminder('once-elapsed', {
      title: 'Elapsed once',
      recurrence: { kind: 'once', at: '2026-06-01T00:00:00Z' },
      timezone: 'UTC',
      status: 'pending',
      nextFireAtMs: Date.parse('2026-06-01T00:00:00Z'),
      armedForMs: Date.parse('2026-06-01T00:00:00Z'),
      notificationIds: ['reminder-once-elapsed'],
    });

    const result = await reconcilePendingReminders(nowMs);
    expect(result.warnings).toEqual([]);
    expect(getReminder('once-elapsed')?.status).toBe('fired');
    // A fired one-shot's own trigger already delivered; it is not re-scheduled or cancelled.
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('leaves a not-yet-armed "once" reminder untouched', async () => {
    const nowMs = Date.parse('2026-06-01T00:00:00Z');
    insertReminder('once-future', {
      title: 'Future once',
      recurrence: { kind: 'once', at: '2026-06-05T00:00:00Z' },
      timezone: 'UTC',
      status: 'pending',
      nextFireAtMs: Date.parse('2026-06-05T00:00:00Z'),
      armedForMs: Date.parse('2026-06-05T00:00:00Z'),
      notificationIds: ['reminder-once-future'],
    });

    await reconcilePendingReminders(nowMs);
    expect(getReminder('once-future')?.status).toBe('pending');
  });

  it('re-arms an elapsed "monthly" reminder for its next occurrence', async () => {
    const nowMs = Date.parse('2026-06-02T00:00:00Z');
    insertReminder('monthly-elapsed', {
      title: 'Pay rent',
      recurrence: { kind: 'monthly', time: '09:00', dayOfMonth: 1 },
      timezone: 'UTC',
      status: 'pending',
      nextFireAtMs: Date.parse('2026-06-01T09:00:00Z'),
      armedForMs: Date.parse('2026-06-01T09:00:00Z'),
      notificationIds: ['reminder-monthly-elapsed'],
    });

    const result = await reconcilePendingReminders(nowMs);
    expect(result.warnings).toEqual([]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'reminder-monthly-elapsed',
    );
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);

    const updated = getReminder('monthly-elapsed');
    expect(updated?.status).toBe('pending');
    expect(updated?.nextFireAtMs).toBe(Date.parse('2026-07-01T09:00:00Z'));
    expect(updated?.armedForMs).toBe(Date.parse('2026-07-01T09:00:00Z'));
  });

  it('does not touch daily/weekly/weekdays reminders', async () => {
    insertReminder('daily1', {
      title: 'Daily',
      recurrence: { kind: 'daily', time: '09:00' },
      timezone: 'UTC',
      status: 'pending',
      notificationIds: ['reminder-daily1'],
    });

    await reconcilePendingReminders(Date.now());
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(getReminder('daily1')?.status).toBe('pending');
  });

  it('collects a warning and leaves the reminder pending when re-arming fails', async () => {
    (Notifications.scheduleNotificationAsync as jest.Mock).mockRejectedValue(new Error('native boom'));
    const nowMs = Date.parse('2026-06-02T00:00:00Z');
    insertReminder('monthly-fail', {
      title: 'Pay rent',
      recurrence: { kind: 'monthly', time: '09:00', dayOfMonth: 1 },
      timezone: 'UTC',
      status: 'pending',
      nextFireAtMs: Date.parse('2026-06-01T09:00:00Z'),
      armedForMs: Date.parse('2026-06-01T09:00:00Z'),
      notificationIds: ['reminder-monthly-fail'],
    });

    const result = await reconcilePendingReminders(nowMs);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/Failed to re-arm/);
    // The row is left as-is (not marked fired, not corrupted) so the next pass retries.
    expect(getReminder('monthly-fail')?.status).toBe('pending');
  });
});
