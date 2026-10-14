jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});
jest.mock('expo-notifications', () =>
  require('../../src/acceptance/e2eAgent/e2eNativeNotificationsModule').createE2ENotificationsModule(),
);

import * as Notifications from 'expo-notifications';
import {
  getE2ENativeMobileFixtureStateSnapshot,
  resetE2ENativeMobileFixtures,
} from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import { executeReminderTool } from '../../src/engine/tools/native/reminders/executor';
import { closeRemindersDb } from '../../src/services/scheduler/reminders/database';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function notificationState() {
  return getE2ENativeMobileFixtureStateSnapshot().notification;
}

beforeEach(() => {
  expoSqlite.__resetExpoSqliteForTests();
  resetE2ENativeMobileFixtures();
});

afterEach(() => {
  jest.restoreAllMocks();
  closeRemindersDb();
});

describe('the live E2E notification boundary', () => {
  it('records a reminder the app schedules and then cancels with the operating system', async () => {
    // The fixture derives the delay from the clock when the OS accepts the notification; a
    // frozen clock keeps a slow run from rounding the 30 s reminder down to 29.
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 0, 5, 9, 0, 0));
    const created = await executeReminderTool({
      action: 'create',
      title: 'Stretch',
      when: { kind: 'once', delaySeconds: 30 },
    });
    const { reminder } = JSON.parse(created.content);

    expect(notificationState()).toMatchObject({
      scheduled: true,
      cancelled: false,
      delaySeconds: 30,
    });
    expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(1);

    await executeReminderTool({ action: 'cancel', id: reminder.id });

    expect(notificationState()).toMatchObject({ scheduled: true, cancelled: true });
    expect(await Notifications.getAllScheduledNotificationsAsync()).toEqual([]);
  });

  it('does not count a notification shown immediately as scheduled', async () => {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Done', body: 'Task finished' },
      trigger: null,
    });
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Done', body: 'On a channel' },
      trigger: { channelId: 'kavi-default' },
    });

    expect(notificationState()).toMatchObject({ scheduled: false, cancelled: false });
  });

  it('does not count cancelling a notification it never scheduled', async () => {
    await Notifications.cancelScheduledNotificationAsync('never-scheduled');

    expect(notificationState().cancelled).toBe(false);
  });
});
