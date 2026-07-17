async function loadCalendarModule() {
  try {
    return await import('expo-calendar');
  } catch {
    return null;
  }
}

export type CalendarMutationRuntime = Pick<
  typeof import('expo-calendar'),
  | 'EntityTypes'
  | 'requestCalendarPermissionsAsync'
  | 'getCalendarsAsync'
  | 'getEventsAsync'
  | 'createEventAsync'
  | 'updateEventAsync'
  | 'getEventAsync'
>;

function calendarDateMatches(actual: unknown, expected: Date): boolean {
  const actualDate = actual instanceof Date ? actual : new Date(String(actual));
  return !isNaN(actualDate.getTime()) && actualDate.getTime() === expected.getTime();
}

function calendarValueMatches(actual: unknown, expected: unknown): boolean {
  if (expected instanceof Date) return calendarDateMatches(actual, expected);
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) => calendarValueMatches(actual[index], value))
    );
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected).every(([field, value]) =>
      calendarValueMatches((actual as Record<string, unknown>)[field], value),
    );
  }
  return actual === expected;
}

function calendarEventMatches(
  event: Record<string, unknown> | null | undefined,
  expected: Record<string, unknown>,
): boolean {
  if (!event || typeof event.id !== 'string' || event.id !== expected.id) {
    return false;
  }
  return Object.entries(expected).every(([field, value]) => {
    if (field === 'id') return true;
    if (
      (field === 'location' || field === 'notes') &&
      value === '' &&
      (event[field] === undefined || event[field] === null || event[field] === '')
    ) {
      return true;
    }
    return calendarValueMatches(event[field], value);
  });
}

export async function executeCalendarList(): Promise<ToolRuntimeOutcome> {
  const Calendar = await loadCalendarModule();
  if (!Calendar) return failedCalendarOutcome({ error: 'Calendar module not available' });

  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return failedCalendarOutcome({ error: 'Calendar permission denied' });

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return completedCalendarOutcome(
    calendars.map((c: any) => ({
      id: c.id,
      title: c.title,
      source: c.source?.name,
      color: c.color,
      allowsModifications: c.allowsModifications,
    })),
  );
}

export async function executeCalendarEvents(args: {
  startDate: string;
  endDate: string;
  calendarId?: string;
}, runtime?: CalendarMutationRuntime): Promise<ToolRuntimeOutcome> {
  const Calendar = runtime ?? (await loadCalendarModule());
  if (!Calendar) return failedCalendarOutcome({ error: 'Calendar module not available' });

  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return failedCalendarOutcome({ error: 'Calendar permission denied' });

  const start = new Date(args.startDate);
  const end = new Date(args.endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return failedCalendarOutcome({ error: 'Invalid date format. Use ISO 8601.' });
  }

  let calendarIds = args.calendarId ? [args.calendarId] : [];
  if (calendarIds.length === 0) {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    calendarIds = calendars
      .map((calendar: { id?: unknown }) => calendar.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }
  if (calendarIds.length === 0) {
    return failedCalendarOutcome({ error: 'No event calendars found on this device.' });
  }

  const events = await Calendar.getEventsAsync(calendarIds, start, end);

  return completedCalendarOutcome(
    events.slice(0, 50).map((e: any) => ({
      id: e.id,
      title: e.title,
      startDate: e.startDate,
      endDate: e.endDate,
      location: e.location,
      notes: e.notes?.slice(0, 200),
      allDay: e.allDay,
    })),
  );
}

export async function executeCalendarCreate(
  args: {
    title: string;
    startDate: string;
    endDate: string;
    location?: string;
    notes?: string;
    calendarId?: string;
    allDay?: boolean;
  },
  runtime?: CalendarMutationRuntime,
): Promise<ToolRuntimeOutcome> {
  const Calendar = runtime ?? (await loadCalendarModule());
  if (!Calendar) return failedCalendarOutcome({ error: 'Calendar module not available' });

  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return failedCalendarOutcome({ error: 'Calendar permission denied' });

  const start = new Date(args.startDate);
  const end = new Date(args.endDate);

  if (isNaN(start.getTime())) {
    return failedCalendarOutcome({
      error: `Invalid start date: "${args.startDate}". Use ISO 8601 format (e.g. 2025-03-20T10:00:00).`,
    });
  }
  if (isNaN(end.getTime())) {
    return failedCalendarOutcome({
      error: `Invalid end date: "${args.endDate}". Use ISO 8601 format (e.g. 2025-03-20T11:00:00).`,
    });
  }

  // Ensure end is after start; if equal, add 1 hour
  if (end.getTime() <= start.getTime()) {
    end.setTime(start.getTime() + 60 * 60 * 1000);
  }

  let calendarId = args.calendarId;
  if (!calendarId) {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    // Prefer the default calendar, then any writable one
    const defaultCal = calendars.find((c: any) => c.isPrimary && c.allowsModifications);
    const writable = defaultCal || calendars.find((c: any) => c.allowsModifications);
    if (!writable)
      return failedCalendarOutcome({
        error: 'No writable calendar found on this device. Please create a calendar first.',
      });
    calendarId = writable.id;
  }

  const isAllDay =
    args.allDay ??
    (start.getHours() === 0 &&
      start.getMinutes() === 0 &&
      end.getHours() === 0 &&
      end.getMinutes() === 0);

  try {
    const eventDetails: Record<string, any> = {
      title: args.title,
      startDate: start,
      endDate: end,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      allDay: isAllDay,
      ...(args.location !== undefined ? { location: args.location } : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
    };

    const eventId = await Calendar.createEventAsync(calendarId, eventDetails);
    try {
      const persisted = (await Calendar.getEventAsync(eventId)) as unknown as Record<
        string,
        unknown
      >;
      const verified = calendarEventMatches(persisted, {
        id: eventId,
        title: args.title,
        startDate: start,
        endDate: end,
        allDay: isAllDay,
        ...(args.location !== undefined ? { location: args.location } : {}),
        ...(args.notes !== undefined ? { notes: args.notes } : {}),
      });
      const content = JSON.stringify({
        status: verified ? 'created_verified' : 'created_unverified',
        eventId,
        calendarId,
        ...(verified ? {} : { verificationError: 'calendar_readback_mismatch' }),
      });
      return verified ? completedToolOutcome(content) : failedToolOutcome(content);
    } catch {
      return failedCalendarOutcome({
        status: 'created_unverified',
        eventId,
        calendarId,
        verificationError: 'calendar_readback_failed',
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return failedCalendarOutcome({ error: `Failed to create event: ${msg}` });
  }
}

export async function executeCalendarUpdate(
  args: {
    id: string;
    title?: string;
    startDate?: string;
    endDate?: string;
    location?: string;
    notes?: string;
    allDay?: boolean;
  },
  runtime?: CalendarMutationRuntime,
): Promise<ToolRuntimeOutcome> {
  const Calendar = runtime ?? (await loadCalendarModule());
  if (!Calendar) return failedCalendarOutcome({ error: 'Calendar module not available' });

  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return failedCalendarOutcome({ error: 'Calendar permission denied' });

  if (!args.id || typeof args.id !== 'string') {
    return failedCalendarOutcome({ error: 'Calendar update requires an event id.' });
  }

  const eventDetails: Record<string, any> = {};
  if (typeof args.title === 'string') eventDetails.title = args.title;
  if (typeof args.location === 'string') eventDetails.location = args.location;
  if (typeof args.notes === 'string') eventDetails.notes = args.notes;
  if (typeof args.allDay === 'boolean') eventDetails.allDay = args.allDay;

  if (typeof args.startDate === 'string') {
    const start = new Date(args.startDate);
    if (isNaN(start.getTime())) {
      return failedCalendarOutcome({ error: 'Invalid start date format. Use ISO 8601.' });
    }
    eventDetails.startDate = start;
  }

  if (typeof args.endDate === 'string') {
    const end = new Date(args.endDate);
    if (isNaN(end.getTime())) {
      return failedCalendarOutcome({ error: 'Invalid end date format. Use ISO 8601.' });
    }
    eventDetails.endDate = end;
  }

  if (
    eventDetails.startDate instanceof Date &&
    eventDetails.endDate instanceof Date &&
    eventDetails.endDate.getTime() <= eventDetails.startDate.getTime()
  ) {
    return failedCalendarOutcome({ error: 'Calendar update requires endDate after startDate.' });
  }

  if (Object.keys(eventDetails).length === 0) {
    return failedCalendarOutcome({
      error: 'Calendar update requires at least one field to change.',
    });
  }

  try {
    let existing: Record<string, unknown>;
    try {
      existing = (await Calendar.getEventAsync(args.id)) as unknown as Record<string, unknown>;
    } catch {
      return failedCalendarOutcome({
        error: 'Calendar event could not be read before update.',
        eventId: args.id,
      });
    }
    if (!existing || existing.id !== args.id) {
      return failedCalendarOutcome({
        error: 'Calendar event read before update did not match the requested event.',
        eventId: args.id,
      });
    }

    const existingStart = new Date(String(existing.startDate));
    const existingEnd = new Date(String(existing.endDate));
    const finalStart =
      eventDetails.startDate instanceof Date
        ? eventDetails.startDate
        : !isNaN(existingStart.getTime())
          ? existingStart
          : undefined;
    const finalEnd =
      eventDetails.endDate instanceof Date
        ? eventDetails.endDate
        : !isNaN(existingEnd.getTime())
          ? existingEnd
          : undefined;
    if (finalStart && finalEnd && finalEnd.getTime() <= finalStart.getTime()) {
      return failedCalendarOutcome({ error: 'Calendar update requires endDate after startDate.' });
    }

    // Expo's legacy iOS adapter supplies defaults for these fields during a partial update.
    // Carry the persisted values through so changing one field cannot erase unrelated event data.
    const completeEventDetails: Record<string, any> = {
      title: typeof existing.title === 'string' ? existing.title : '',
      location: typeof existing.location === 'string' ? existing.location : '',
      notes: typeof existing.notes === 'string' ? existing.notes : '',
      allDay: typeof existing.allDay === 'boolean' ? existing.allDay : false,
      availability:
        typeof existing.availability === 'string' ? existing.availability : 'notSupported',
      alarms: Array.isArray(existing.alarms) ? existing.alarms : [],
      ...(finalStart ? { startDate: finalStart } : {}),
      ...(finalEnd ? { endDate: finalEnd } : {}),
      ...eventDetails,
    };

    await Calendar.updateEventAsync(args.id, completeEventDetails);
    try {
      const persisted = (await Calendar.getEventAsync(args.id)) as unknown as Record<
        string,
        unknown
      >;
      const preservedFields = [
        'calendarId',
        'timeZone',
        'url',
        'recurrenceRule',
      ].reduce<Record<string, unknown>>((fields, field) => {
        if (existing[field] !== undefined) fields[field] = existing[field];
        return fields;
      }, {});
      const verified = calendarEventMatches(persisted, {
        id: args.id,
        ...preservedFields,
        ...completeEventDetails,
      });
      const content = JSON.stringify({
        status: verified ? 'updated_verified' : 'updated_unverified',
        eventId: args.id,
        ...(verified ? {} : { verificationError: 'calendar_readback_mismatch' }),
      });
      return verified ? completedToolOutcome(content) : failedToolOutcome(content);
    } catch {
      return failedCalendarOutcome({
        status: 'updated_unverified',
        eventId: args.id,
        verificationError: 'calendar_readback_failed',
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return failedCalendarOutcome({ error: `Failed to update event: ${msg}` });
  }
}
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../../../types/toolRuntimeOutcome';

function completedCalendarOutcome(value: unknown): ToolRuntimeOutcome {
  return completedToolOutcome(JSON.stringify(value));
}

function failedCalendarOutcome(value: unknown): ToolRuntimeOutcome {
  return failedToolOutcome(JSON.stringify(value));
}
