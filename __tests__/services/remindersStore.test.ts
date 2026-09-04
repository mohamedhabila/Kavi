jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeRemindersDb } from '../../src/services/scheduler/reminders/database';
import {
  deleteReminderRow,
  getReminder,
  insertReminder,
  listAllReminders,
  listPendingReminders,
  updateReminderRow,
} from '../../src/services/scheduler/reminders/store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  expoSqlite.__resetExpoSqliteForTests();
});

afterEach(() => {
  closeRemindersDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('reminders store', () => {
  it('inserts and retrieves a "once" reminder', () => {
    const record = insertReminder('r1', {
      title: 'Call mom',
      notes: 'Ask about weekend plans',
      recurrence: { kind: 'once', at: '2026-09-10T18:00:00-04:00' },
      timezone: 'America/New_York',
      status: 'pending',
      nextFireAtMs: 1000,
      armedForMs: 1000,
      notificationIds: ['reminder-r1'],
    });
    expect(record.id).toBe('r1');
    expect(record.title).toBe('Call mom');
    expect(record.notes).toBe('Ask about weekend plans');
    expect(record.recurrence).toEqual({ kind: 'once', at: '2026-09-10T18:00:00-04:00' });
    expect(record.status).toBe('pending');
    expect(record.notificationIds).toEqual(['reminder-r1']);

    const fetched = getReminder('r1');
    expect(fetched).toEqual(record);
  });

  it('round-trips every recurrence kind', () => {
    insertReminder('daily', {
      title: 'Daily',
      recurrence: { kind: 'daily', time: '09:00' },
      timezone: 'UTC',
      status: 'pending',
      notificationIds: ['n1'],
    });
    insertReminder('weekdays', {
      title: 'Weekdays',
      recurrence: { kind: 'weekdays', time: '08:00' },
      timezone: 'UTC',
      status: 'pending',
      notificationIds: ['n2a', 'n2b', 'n2c', 'n2d', 'n2e'],
    });
    insertReminder('weekly', {
      title: 'Weekly',
      recurrence: { kind: 'weekly', time: '10:00', weekday: 3 },
      timezone: 'UTC',
      status: 'pending',
      notificationIds: ['n3'],
    });
    insertReminder('monthly', {
      title: 'Monthly',
      recurrence: { kind: 'monthly', time: '11:00', dayOfMonth: 15 },
      timezone: 'UTC',
      status: 'pending',
      notificationIds: ['n4'],
      nextFireAtMs: 5000,
      armedForMs: 5000,
    });

    expect(getReminder('daily')?.recurrence).toEqual({ kind: 'daily', time: '09:00' });
    expect(getReminder('weekdays')?.recurrence).toEqual({ kind: 'weekdays', time: '08:00' });
    expect(getReminder('weekly')?.recurrence).toEqual({ kind: 'weekly', time: '10:00', weekday: 3 });
    expect(getReminder('monthly')?.recurrence).toEqual({
      kind: 'monthly',
      time: '11:00',
      dayOfMonth: 15,
    });
    expect(getReminder('weekdays')?.notificationIds).toEqual(['n2a', 'n2b', 'n2c', 'n2d', 'n2e']);
  });

  it('returns undefined for a missing id', () => {
    expect(getReminder('does-not-exist')).toBeUndefined();
  });

  it('lists only pending reminders, sorted by next fire time', () => {
    insertReminder('later', {
      title: 'Later',
      recurrence: { kind: 'once', at: '2026-01-01T00:00:00Z' },
      timezone: 'UTC',
      status: 'pending',
      nextFireAtMs: 2000,
      notificationIds: [],
    });
    insertReminder('sooner', {
      title: 'Sooner',
      recurrence: { kind: 'once', at: '2026-01-01T00:00:00Z' },
      timezone: 'UTC',
      status: 'pending',
      nextFireAtMs: 1000,
      notificationIds: [],
    });
    insertReminder('done', {
      title: 'Done',
      recurrence: { kind: 'once', at: '2026-01-01T00:00:00Z' },
      timezone: 'UTC',
      status: 'fired',
      nextFireAtMs: 500,
      notificationIds: [],
    });

    const pending = listPendingReminders();
    expect(pending.map((r) => r.id)).toEqual(['sooner', 'later']);

    const all = listAllReminders();
    expect(all.map((r) => r.id)).toEqual(['done', 'sooner', 'later']);
  });

  it('updates a reminder in place, replacing its full state', () => {
    insertReminder('u1', {
      title: 'Original',
      recurrence: { kind: 'daily', time: '09:00' },
      timezone: 'UTC',
      status: 'pending',
      notificationIds: ['old-id'],
    });

    const updated = updateReminderRow('u1', {
      title: 'Updated',
      notes: 'New notes',
      recurrence: { kind: 'weekly', time: '10:00', weekday: 2 },
      timezone: 'Europe/Berlin',
      status: 'pending',
      nextFireAtMs: 9999,
      notificationIds: ['new-id'],
    });

    expect(updated).toMatchObject({
      title: 'Updated',
      notes: 'New notes',
      recurrence: { kind: 'weekly', time: '10:00', weekday: 2 },
      timezone: 'Europe/Berlin',
      nextFireAtMs: 9999,
      notificationIds: ['new-id'],
    });
  });

  it('returns undefined when updating a nonexistent reminder', () => {
    const result = updateReminderRow('missing', {
      title: 'x',
      recurrence: { kind: 'daily', time: '09:00' },
      timezone: 'UTC',
      status: 'pending',
      notificationIds: [],
    });
    expect(result).toBeUndefined();
  });

  it('deletes a reminder', () => {
    insertReminder('d1', {
      title: 'Delete me',
      recurrence: { kind: 'daily', time: '09:00' },
      timezone: 'UTC',
      status: 'pending',
      notificationIds: [],
    });
    expect(deleteReminderRow('d1')).toBe(true);
    expect(getReminder('d1')).toBeUndefined();
    expect(deleteReminderRow('d1')).toBe(false);
  });
});
