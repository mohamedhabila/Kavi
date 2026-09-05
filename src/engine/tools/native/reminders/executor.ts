// ---------------------------------------------------------------------------
// Kavi — Reminder Tool Executor
// ---------------------------------------------------------------------------

import {
  cancelReminder,
  createReminder,
  listReminders,
  ReminderCommandError,
  updateReminder,
  type UpdateReminderInput,
} from '../../../../services/scheduler/reminders/commands';
import {
  parseReminderWhen,
  resolveReminderTimezone,
  type ReminderRepairFields,
} from '../../../../services/scheduler/reminders/input';
import { formatZonedIso } from '../../../../services/scheduler/reminders/format';
import type { ReminderRecord } from '../../../../services/scheduler/reminders/types';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../../../types/toolRuntimeOutcome';

function rejectedOutcome(
  code: string,
  error: string,
  extra?: Readonly<Record<string, unknown>>,
): ToolRuntimeOutcome {
  return failedToolOutcome(JSON.stringify({ status: 'rejected', code, error, ...extra }));
}

/** Builds a truthful repair payload: only fields genuinely absent go under missingFields. */
function repairFor(fields: ReminderRepairFields): { retryable: true } & ReminderRepairFields {
  return { retryable: true, missingFields: fields.missingFields, invalidFields: fields.invalidFields };
}

function reminderErrorOutcome(error: unknown): ToolRuntimeOutcome {
  if (error instanceof ReminderCommandError) {
    return rejectedOutcome(error.code, error.message);
  }
  return failedToolOutcome(
    JSON.stringify({
      status: 'error',
      code: 'reminder_command_failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

function formatReminderForOutput(reminder: ReminderRecord): Record<string, unknown> {
  return {
    id: reminder.id,
    title: reminder.title,
    notes: reminder.notes,
    recurrence: reminder.recurrence,
    timezone: reminder.timezone,
    status: reminder.status,
    nextFireAt:
      reminder.nextFireAtMs !== undefined
        ? formatZonedIso(reminder.nextFireAtMs, reminder.timezone)
        : undefined,
  };
}

async function handleCreate(args: Record<string, unknown>): Promise<ToolRuntimeOutcome> {
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!title) {
    return rejectedOutcome('reminder_title_required', 'A reminder title is required for create.', {
      repair: { retryable: true, missingFields: ['title'] },
    });
  }
  const whenResult = parseReminderWhen(args.when);
  if (!whenResult.ok) {
    return rejectedOutcome('reminder_when_invalid', whenResult.error, {
      repair: repairFor(whenResult),
    });
  }
  const tzResult = resolveReminderTimezone(args.timezone);
  if (!tzResult.ok) {
    return rejectedOutcome('reminder_timezone_invalid', tzResult.error, {
      repair: repairFor(tzResult),
    });
  }
  const notes = typeof args.notes === 'string' && args.notes.trim() ? args.notes.trim() : undefined;

  try {
    const reminder = await createReminder({
      title,
      notes,
      recurrence: whenResult.recurrence,
      timezone: tzResult.timezone,
    });
    return completedToolOutcome(
      JSON.stringify({ status: 'reminder_created', reminder: formatReminderForOutput(reminder) }),
    );
  } catch (error) {
    return reminderErrorOutcome(error);
  }
}

function handleList(): ToolRuntimeOutcome {
  const reminders = listReminders();
  return completedToolOutcome(
    JSON.stringify({ status: 'listed', reminders: reminders.map(formatReminderForOutput) }),
  );
}

async function handleUpdate(args: Record<string, unknown>): Promise<ToolRuntimeOutcome> {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  if (!id) {
    return rejectedOutcome('reminder_id_required', 'A reminder id is required for update.', {
      repair: { retryable: true, missingFields: ['id'] },
    });
  }

  const updates: UpdateReminderInput = {};
  if (typeof args.title === 'string') {
    const title = args.title.trim();
    if (!title) {
      return rejectedOutcome('reminder_title_required', 'title cannot be empty.', {
        repair: { retryable: true, invalidFields: ['title'] },
      });
    }
    updates.title = title;
  }
  if (typeof args.notes === 'string') {
    updates.notes = args.notes.trim();
  }
  if (args.when !== undefined) {
    const whenResult = parseReminderWhen(args.when);
    if (!whenResult.ok) {
      return rejectedOutcome('reminder_when_invalid', whenResult.error, {
        repair: repairFor(whenResult),
      });
    }
    updates.recurrence = whenResult.recurrence;
  }
  if (typeof args.timezone === 'string' && args.timezone.trim()) {
    const tzResult = resolveReminderTimezone(args.timezone);
    if (!tzResult.ok) {
      return rejectedOutcome('reminder_timezone_invalid', tzResult.error, {
        repair: repairFor(tzResult),
      });
    }
    updates.timezone = tzResult.timezone;
  }

  try {
    const reminder = await updateReminder(id, updates);
    return completedToolOutcome(
      JSON.stringify({ status: 'reminder_updated', reminder: formatReminderForOutput(reminder) }),
    );
  } catch (error) {
    return reminderErrorOutcome(error);
  }
}

async function handleCancel(args: Record<string, unknown>): Promise<ToolRuntimeOutcome> {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  if (!id) {
    return rejectedOutcome('reminder_id_required', 'A reminder id is required for cancel.', {
      repair: { retryable: true, missingFields: ['id'] },
    });
  }
  try {
    await cancelReminder(id);
    return completedToolOutcome(JSON.stringify({ status: 'reminder_cancelled', id }));
  } catch (error) {
    return reminderErrorOutcome(error);
  }
}

export async function executeReminderTool(args: Record<string, unknown>): Promise<ToolRuntimeOutcome> {
  const action = typeof args?.action === 'string' ? args.action : '';
  switch (action) {
    case 'create':
      return handleCreate(args);
    case 'list':
      return handleList();
    case 'update':
      return handleUpdate(args);
    case 'cancel':
      return handleCancel(args);
    default:
      return rejectedOutcome('reminder_action_unknown', `Unknown reminder action: ${action}`, {
        repair: { retryable: true, invalidFields: ['action'] },
      });
  }
}
