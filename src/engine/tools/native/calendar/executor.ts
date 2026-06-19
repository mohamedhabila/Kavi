async function loadCalendarModule() {
  try {
    return await import('expo-calendar');
  } catch {
    return null;
  }
}

export async function executeCalendarList(): Promise<string> {
  const Calendar = await loadCalendarModule();
  if (!Calendar) return JSON.stringify({ error: 'Calendar module not available' });

  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return JSON.stringify({ error: 'Calendar permission denied' });

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return JSON.stringify(
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
}): Promise<string> {
  const Calendar = await loadCalendarModule();
  if (!Calendar) return JSON.stringify({ error: 'Calendar module not available' });

  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return JSON.stringify({ error: 'Calendar permission denied' });

  const start = new Date(args.startDate);
  const end = new Date(args.endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return JSON.stringify({ error: 'Invalid date format. Use ISO 8601.' });
  }

  const calendarIds = args.calendarId ? [args.calendarId] : undefined;
  const events = await Calendar.getEventsAsync(calendarIds as any, start, end);

  return JSON.stringify(
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

export async function executeCalendarCreate(args: {
  title: string;
  startDate: string;
  endDate: string;
  location?: string;
  notes?: string;
  calendarId?: string;
  allDay?: boolean;
}): Promise<string> {
  const Calendar = await loadCalendarModule();
  if (!Calendar) return JSON.stringify({ error: 'Calendar module not available' });

  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return JSON.stringify({ error: 'Calendar permission denied' });

  const start = new Date(args.startDate);
  const end = new Date(args.endDate);

  if (isNaN(start.getTime())) {
    return JSON.stringify({
      error: `Invalid start date: "${args.startDate}". Use ISO 8601 format (e.g. 2025-03-20T10:00:00).`,
    });
  }
  if (isNaN(end.getTime())) {
    return JSON.stringify({
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
      return JSON.stringify({
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
      location: args.location,
      notes: args.notes,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      allDay: isAllDay,
    };

    const eventId = await Calendar.createEventAsync(calendarId, eventDetails);
    return JSON.stringify({ status: 'created', eventId, calendarId });
  } catch (err: unknown) {
    // Provide actionable error messages
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('could not be saved') || msg.includes('saveEventAsync')) {
      return JSON.stringify({
        error: `Calendar event could not be saved. This usually means the calendar doesn't accept events at this time. Try: (1) Use a different calendarId (call calendar_list first), (2) Check the date format is ISO 8601, (3) Ensure end date is after start date.`,
        details: msg,
      });
    }
    return JSON.stringify({ error: `Failed to create event: ${msg}` });
  }
}

export async function executeCalendarUpdate(args: {
  id: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  notes?: string;
  allDay?: boolean;
}): Promise<string> {
  const Calendar = await loadCalendarModule();
  if (!Calendar) return JSON.stringify({ error: 'Calendar module not available' });

  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return JSON.stringify({ error: 'Calendar permission denied' });

  if (!args.id || typeof args.id !== 'string') {
    return JSON.stringify({ error: 'Calendar update requires an event id.' });
  }

  const eventDetails: Record<string, any> = {};
  if (typeof args.title === 'string') eventDetails.title = args.title;
  if (typeof args.location === 'string') eventDetails.location = args.location;
  if (typeof args.notes === 'string') eventDetails.notes = args.notes;
  if (typeof args.allDay === 'boolean') eventDetails.allDay = args.allDay;

  if (typeof args.startDate === 'string') {
    const start = new Date(args.startDate);
    if (isNaN(start.getTime())) {
      return JSON.stringify({ error: 'Invalid start date format. Use ISO 8601.' });
    }
    eventDetails.startDate = start;
  }

  if (typeof args.endDate === 'string') {
    const end = new Date(args.endDate);
    if (isNaN(end.getTime())) {
      return JSON.stringify({ error: 'Invalid end date format. Use ISO 8601.' });
    }
    eventDetails.endDate = end;
  }

  if (
    eventDetails.startDate instanceof Date &&
    eventDetails.endDate instanceof Date &&
    eventDetails.endDate.getTime() <= eventDetails.startDate.getTime()
  ) {
    return JSON.stringify({ error: 'Calendar update requires endDate after startDate.' });
  }

  if (Object.keys(eventDetails).length === 0) {
    return JSON.stringify({ error: 'Calendar update requires at least one field to change.' });
  }

  try {
    await Calendar.updateEventAsync(args.id, eventDetails);
    return JSON.stringify({ status: 'updated', eventId: args.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: `Failed to update event: ${msg}` });
  }
}
