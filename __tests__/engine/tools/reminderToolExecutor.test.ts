jest.mock('../../../src/services/scheduler/reminders/commands', () => ({
  createReminder: jest.fn(),
  listReminders: jest.fn(),
  updateReminder: jest.fn(),
  cancelReminder: jest.fn(),
  ReminderCommandError: class ReminderCommandError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { executeReminderTool } from '../../../src/engine/tools/native/reminders/executor';
import {
  cancelReminder,
  createReminder,
  listReminders,
  ReminderCommandError,
  updateReminder,
} from '../../../src/services/scheduler/reminders/commands';

function parse(content: string): any {
  return JSON.parse(content);
}

const baseReminder = {
  id: 'r1',
  title: 'Call mom',
  notes: undefined,
  recurrence: { kind: 'daily' as const, time: '09:00' },
  timezone: 'UTC',
  status: 'pending' as const,
  nextFireAtMs: Date.parse('2026-06-01T09:00:00Z'),
  armedForMs: undefined,
  notificationIds: ['reminder-r1'],
  createdAtMs: 0,
  updatedAtMs: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('executeReminderTool: create', () => {
  it('rejects a missing title', async () => {
    const result = await executeReminderTool({ action: 'create', when: { kind: 'daily', time: '09:00' } });
    expect(result.status).toBe('failed');
    expect(parse(result.content).code).toBe('reminder_title_required');
    expect(createReminder).not.toHaveBeenCalled();
  });

  it('rejects an invalid "when"', async () => {
    const result = await executeReminderTool({
      action: 'create',
      title: 'x',
      when: { kind: 'monthly', time: '09:00' },
    });
    expect(result.status).toBe('failed');
    expect(parse(result.content).code).toBe('reminder_when_invalid');
  });

  it('rejects an invalid timezone', async () => {
    const result = await executeReminderTool({
      action: 'create',
      title: 'x',
      when: { kind: 'daily', time: '09:00' },
      timezone: 'Not/AZone',
    });
    expect(result.status).toBe('failed');
    expect(parse(result.content).code).toBe('reminder_timezone_invalid');
  });

  it('creates a reminder and formats the response with a zoned next-fire time', async () => {
    (createReminder as jest.Mock).mockResolvedValue(baseReminder);
    const result = await executeReminderTool({
      action: 'create',
      title: 'Call mom',
      when: { kind: 'daily', time: '09:00' },
      timezone: 'UTC',
    });
    expect(result.status).toBe('completed');
    const parsed = parse(result.content);
    expect(parsed.status).toBe('reminder_created');
    expect(parsed.reminder.id).toBe('r1');
    expect(parsed.reminder.nextFireAt).toBe('2026-06-01T09:00:00+00:00');
    expect(createReminder).toHaveBeenCalledWith({
      title: 'Call mom',
      notes: undefined,
      recurrence: { kind: 'daily', time: '09:00' },
      timezone: 'UTC',
    });
  });

  it('surfaces a ReminderCommandError as a rejected outcome', async () => {
    (createReminder as jest.Mock).mockRejectedValue(
      new ReminderCommandError('reminder_notification_schedule_failed', 'native boom'),
    );
    const result = await executeReminderTool({
      action: 'create',
      title: 'x',
      when: { kind: 'daily', time: '09:00' },
    });
    expect(result.status).toBe('failed');
    expect(parse(result.content)).toMatchObject({
      code: 'reminder_notification_schedule_failed',
      error: 'native boom',
    });
  });
});

describe('executeReminderTool: list', () => {
  it('returns all pending reminders', async () => {
    (listReminders as jest.Mock).mockReturnValue([baseReminder]);
    const result = await executeReminderTool({ action: 'list' });
    expect(result.status).toBe('completed');
    const parsed = parse(result.content);
    expect(parsed.status).toBe('listed');
    expect(parsed.reminders).toHaveLength(1);
    expect(parsed.reminders[0].id).toBe('r1');
  });
});

describe('executeReminderTool: update', () => {
  it('requires an id', async () => {
    const result = await executeReminderTool({ action: 'update' });
    expect(result.status).toBe('failed');
    expect(parse(result.content).code).toBe('reminder_id_required');
  });

  it('passes only the provided fields through as updates', async () => {
    (updateReminder as jest.Mock).mockResolvedValue(baseReminder);
    await executeReminderTool({ action: 'update', id: 'r1', notes: 'new notes' });
    expect(updateReminder).toHaveBeenCalledWith('r1', { notes: 'new notes' });
  });

  it('rejects an empty title on update', async () => {
    const result = await executeReminderTool({ action: 'update', id: 'r1', title: '   ' });
    expect(result.status).toBe('failed');
    expect(parse(result.content).code).toBe('reminder_title_required');
    expect(updateReminder).not.toHaveBeenCalled();
  });
});

describe('executeReminderTool: cancel', () => {
  it('requires an id', async () => {
    const result = await executeReminderTool({ action: 'cancel' });
    expect(result.status).toBe('failed');
    expect(parse(result.content).code).toBe('reminder_id_required');
  });

  it('cancels by id', async () => {
    (cancelReminder as jest.Mock).mockResolvedValue(undefined);
    const result = await executeReminderTool({ action: 'cancel', id: 'r1' });
    expect(result.status).toBe('completed');
    expect(parse(result.content)).toEqual({ status: 'reminder_cancelled', id: 'r1' });
    expect(cancelReminder).toHaveBeenCalledWith('r1');
  });
});

describe('executeReminderTool: unknown action', () => {
  it('rejects an unrecognized action', async () => {
    const result = await executeReminderTool({ action: 'explode' });
    expect(result.status).toBe('failed');
    expect(parse(result.content).code).toBe('reminder_action_unknown');
  });
});
