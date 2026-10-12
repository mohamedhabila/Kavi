jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import * as Notifications from 'expo-notifications';
import { executeReminderTool } from '../../../src/engine/tools/native/reminders/executor';
import { closeRemindersDb } from '../../../src/services/scheduler/reminders/database';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const CALL_TIME = Date.parse('2026-10-12T10:00:00.000Z');

function parse(content: string): any {
  return JSON.parse(content);
}

function scheduledRequest(): {
  identifier: string;
  content: { title: string; body: string };
  trigger: { date: number };
} {
  return (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  expoSqlite.__resetExpoSqliteForTests();
  jest.spyOn(Date, 'now').mockReturnValue(CALL_TIME);
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(
    async (request: { identifier: string }) => request.identifier,
  );
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  closeRemindersDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('a reminder after a delay', () => {
  it('schedules the notification the given seconds after the call runs', async () => {
    const result = await executeReminderTool({
      action: 'create',
      title: 'Stretch',
      when: { kind: 'once', delaySeconds: 30 },
      timezone: 'UTC',
    });

    expect(result.status).toBe('completed');
    expect(parse(result.content).reminder).toMatchObject({
      title: 'Stretch',
      recurrence: { kind: 'once', at: '2026-10-12T10:00:30.000Z' },
      nextFireAt: '2026-10-12T10:00:30+00:00',
    });
    expect(scheduledRequest().trigger.date).toBe(CALL_TIME + 30_000);
  });

  // Traced on the GLM 5.3 Flash suite (direct-spabench-cross-app-device-actions): asked to
  // "schedule a notification for 30 seconds and cancel it", the model sent the text as notes
  // with no title, was refused seven times, and then computed an absolute time from the
  // request timestamp that had already passed.
  it('titles a reminder given only notes, and cancels it by the id it returned', async () => {
    const created = await executeReminderTool({
      action: 'create',
      notes: 'Test notification',
      when: { kind: 'once', delaySeconds: 30 },
    });
    const { reminder } = parse(created.content);

    expect(created.status).toBe('completed');
    expect(reminder).toMatchObject({ title: 'Test notification' });
    expect(reminder).not.toHaveProperty('notes');
    expect(scheduledRequest().content).toMatchObject({ title: 'Test notification', body: '' });

    const cancelled = await executeReminderTool({ action: 'cancel', id: reminder.id });

    expect(parse(cancelled.content)).toEqual({ status: 'reminder_cancelled', id: reminder.id });
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      scheduledRequest().identifier,
    );
  });

  it('keeps the title and notes apart when both are given', async () => {
    const created = await executeReminderTool({
      action: 'create',
      title: 'Call mom',
      notes: 'Ask about the weekend',
      when: { kind: 'once', delaySeconds: 600 },
    });

    expect(parse(created.content).reminder).toMatchObject({
      title: 'Call mom',
      notes: 'Ask about the weekend',
    });
    expect(scheduledRequest().content).toMatchObject({
      title: 'Call mom',
      body: 'Ask about the weekend',
    });
  });

  it('still refuses a reminder with no text at all', async () => {
    const result = await executeReminderTool({
      action: 'create',
      notes: '   ',
      when: { kind: 'once', delaySeconds: 30 },
    });

    expect(result.status).toBe('failed');
    expect(parse(result.content)).toMatchObject({
      code: 'reminder_title_required',
      repair: { missingFields: ['title'] },
    });
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
