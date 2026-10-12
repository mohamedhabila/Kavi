jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});
jest.mock('expo-notifications', () =>
  require('../../src/acceptance/e2eAgent/e2eNativeNotificationsModule').createE2ENotificationsModule(),
);

import {
  resetE2EMemorySandbox,
  teardownE2EMemorySandbox,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import { executeReminderTool } from '../../src/engine/tools/native/reminders/executor';

function parse(content: string): any {
  return JSON.parse(content);
}

afterAll(() => {
  teardownE2EMemorySandbox();
});

// Traced on the GLM 5.3 Flash suite (f6687f45): once a scenario had opened the reminders
// database, the next scenario's sandbox reset closed it underneath the store, and every
// reminder call after that failed with reminder_command_failed.
describe('the E2E sandbox reset', () => {
  it('starts each scenario with a working, empty reminders store', async () => {
    resetE2EMemorySandbox();
    const first = await executeReminderTool({
      action: 'create',
      title: 'Stretch',
      when: { kind: 'once', delaySeconds: 30 },
    });
    expect(parse(first.content).status).toBe('reminder_created');

    resetE2EMemorySandbox();

    const listed = await executeReminderTool({ action: 'list' });
    expect(parse(listed.content)).toEqual({ status: 'listed', reminders: [] });
    const second = await executeReminderTool({
      action: 'create',
      title: 'Drink water',
      when: { kind: 'once', delaySeconds: 60 },
    });
    expect(parse(second.content).status).toBe('reminder_created');
    const cancelled = await executeReminderTool({
      action: 'cancel',
      id: parse(second.content).reminder.id,
    });
    expect(parse(cancelled.content).status).toBe('reminder_cancelled');
  });
});
