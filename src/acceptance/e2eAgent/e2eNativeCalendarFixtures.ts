// ---------------------------------------------------------------------------
// Kavi — E2E fake phone: calendar
// ---------------------------------------------------------------------------
// The scenario phone's one calendar and its events (none unless the scenario seeds some),
// and the calendar tools as the device answers them.

import {
  completedE2ENativeOutcome,
  failedE2ENativeOutcome,
  type E2ENativeMobileOutcome,
} from './e2eNativeMobileOutcome';

export const E2E_FIXTURE_CALENDAR_LIST_JSON = JSON.stringify([
  {
    id: 'e2e-cal-1',
    title: 'E2E Calendar',
    source: 'e2e',
    color: '#3366ff',
    allowsModifications: true,
  },
]);

export const E2E_FIXTURE_CALENDAR_EVENTS_JSON = JSON.stringify([]);

const E2E_CALENDAR_UPDATE_FIELDS = [
  'title',
  'startDate',
  'endDate',
  'location',
  'notes',
  'allDay',
] as const;

export function hasE2ECalendarUpdateField(args: Record<string, unknown>): boolean {
  return E2E_CALENDAR_UPDATE_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(args, field),
  );
}

export type E2ECalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  startDate: string;
  endDate: string;
  location?: string;
  notes?: string;
  allDay: boolean;
};

export type E2ECalendarFixtureState = {
  listed: boolean;
  allowsModifications: boolean;
  createdEventCount: number;
  updatedEventCount: number;
  lastCreatedEventId: string;
  lastCreatedTitle: string;
  lastCreatedStartDate: string;
  lastCreatedEndDate: string;
  lastCreatedDurationMinutes: number;
  lastUpdatedEventId: string;
  lastUpdatedStartDate: string;
  lastUpdatedEndDate: string;
};

export function createEmptyE2ECalendarState(): E2ECalendarFixtureState {
  return {
    listed: false,
    allowsModifications: false,
    createdEventCount: 0,
    updatedEventCount: 0,
    lastCreatedEventId: '',
    lastCreatedTitle: '',
    lastCreatedStartDate: '',
    lastCreatedEndDate: '',
    lastCreatedDurationMinutes: 0,
    lastUpdatedEventId: '',
    lastUpdatedStartDate: '',
    lastUpdatedEndDate: '',
  };
}

let e2eCalendarEventId = 0;
let e2eCalendarEvents: E2ECalendarEvent[] = [];
let e2eLastCreatedCalendarEventId: string | null = null;

export function resetE2ECalendarEvents(): void {
  e2eCalendarEventId = 0;
  e2eCalendarEvents = [];
  e2eLastCreatedCalendarEventId = null;
}

export function seedE2ECalendarEvents(events: ReadonlyArray<E2ECalendarEvent>): void {
  e2eCalendarEvents = events.map((event) => ({ ...event }));
}

function readStringArg(args: Record<string, unknown>, key: string, fallback: string): string {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function readOptionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readDateMs(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function normalizeFixtureDate(value: unknown, fallbackIso: string): string {
  const timestamp = readDateMs(value);
  return timestamp === undefined ? fallbackIso : new Date(timestamp).toISOString();
}

function normalizeFixtureEndDate(startIso: string, value: unknown, fallbackIso: string): string {
  const startMs = Date.parse(startIso);
  const endMs = readDateMs(value);
  if (endMs !== undefined && endMs > startMs) {
    return new Date(endMs).toISOString();
  }
  const fallbackMs = Date.parse(fallbackIso);
  return new Date(Math.max(fallbackMs, startMs + 60 * 60 * 1000)).toISOString();
}

function serializeE2ECalendarEvent(event: E2ECalendarEvent): Record<string, unknown> {
  return {
    id: event.id,
    calendarId: event.calendarId,
    title: event.title,
    startDate: event.startDate,
    endDate: event.endDate,
    location: event.location,
    notes: event.notes?.slice(0, 200),
    allDay: event.allDay,
  };
}

function e2eCalendarEventsEqual(left: E2ECalendarEvent, right: E2ECalendarEvent): boolean {
  return (
    left.id === right.id &&
    left.calendarId === right.calendarId &&
    left.title === right.title &&
    left.startDate === right.startDate &&
    left.endDate === right.endDate &&
    left.location === right.location &&
    left.notes === right.notes &&
    left.allDay === right.allDay
  );
}

function recordLastCreatedCalendarTiming(
  state: E2ECalendarFixtureState,
  event: E2ECalendarEvent,
): void {
  const durationMinutes = (Date.parse(event.endDate) - Date.parse(event.startDate)) / 60_000;
  state.lastCreatedEventId = event.id;
  state.lastCreatedTitle = event.title;
  state.lastCreatedStartDate = event.startDate;
  state.lastCreatedEndDate = event.endDate;
  state.lastCreatedDurationMinutes = Math.max(0, Math.min(10_080, durationMinutes));
}

function readE2ECalendarEvents(args: Record<string, unknown>): Record<string, unknown>[] {
  const calendarId = readOptionalStringArg(args, 'calendarId');
  const startMs = readDateMs(args.startDate);
  const endMs = readDateMs(args.endDate);

  return e2eCalendarEvents
    .filter((event) => {
      if (calendarId && event.calendarId !== calendarId) {
        return false;
      }
      const eventStartMs = Date.parse(event.startDate);
      const eventEndMs = Date.parse(event.endDate);
      if (startMs !== undefined && eventEndMs < startMs) {
        return false;
      }
      if (endMs !== undefined && eventStartMs > endMs) {
        return false;
      }
      return true;
    })
    .slice(0, 50)
    .map(serializeE2ECalendarEvent);
}

/** The calendar tools on the scenario phone, or null for any other tool. */
export function executeE2ECalendarFixtureTool(
  name: string,
  args: Record<string, unknown>,
  state: E2ECalendarFixtureState,
): E2ENativeMobileOutcome | null {
  switch (name) {
    case 'calendar_list':
      state.listed = true;
      state.allowsModifications = true;
      return completedE2ENativeOutcome(E2E_FIXTURE_CALENDAR_LIST_JSON);
    case 'calendar_events':
      state.listed = true;
      return completedE2ENativeOutcome(readE2ECalendarEvents(args));
    case 'calendar_create_event': {
      e2eCalendarEventId += 1;
      state.createdEventCount += 1;
      const startDate = normalizeFixtureDate(args.startDate, '2026-06-12T10:00:00.000Z');
      const event: E2ECalendarEvent = {
        id: `e2e-event-${e2eCalendarEventId}`,
        calendarId: readStringArg(args, 'calendarId', 'e2e-cal-1'),
        title: readStringArg(args, 'title', `E2E Event ${e2eCalendarEventId}`),
        startDate,
        endDate: normalizeFixtureEndDate(startDate, args.endDate, '2026-06-12T11:00:00.000Z'),
        ...(readOptionalStringArg(args, 'location')
          ? { location: readOptionalStringArg(args, 'location') }
          : {}),
        ...(readOptionalStringArg(args, 'notes')
          ? { notes: readOptionalStringArg(args, 'notes') }
          : {}),
        allDay: typeof args.allDay === 'boolean' ? args.allDay : false,
      };
      e2eCalendarEvents.push(event);
      e2eLastCreatedCalendarEventId = event.id;
      recordLastCreatedCalendarTiming(state, event);
      return completedE2ENativeOutcome({
        status: 'created_verified',
        eventId: event.id,
        calendarId: event.calendarId,
        event: serializeE2ECalendarEvent(event),
      });
    }
    case 'calendar_update_event': {
      const eventId = readStringArg(args, 'id', 'e2e-event-1');
      if (!hasE2ECalendarUpdateField(args)) {
        return failedE2ENativeOutcome({
          status: 'invalid_request',
          error: 'Calendar update requires at least one field to change.',
        });
      }
      const eventIndex = e2eCalendarEvents.findIndex((event) => event.id === eventId);
      if (eventIndex < 0) {
        return failedE2ENativeOutcome({
          status: 'not_found',
          code: 'not_found',
          eventId,
        });
      }
      const existing = e2eCalendarEvents[eventIndex]!;
      const nextStartDate =
        typeof args.startDate === 'string'
          ? normalizeFixtureDate(args.startDate, existing.startDate)
          : existing.startDate;
      const nextEndDate =
        typeof args.endDate === 'string'
          ? normalizeFixtureEndDate(nextStartDate, args.endDate, existing.endDate)
          : normalizeFixtureEndDate(nextStartDate, existing.endDate, existing.endDate);
      const nextTitle = readOptionalStringArg(args, 'title');
      const nextLocation = readOptionalStringArg(args, 'location');
      const nextNotes = readOptionalStringArg(args, 'notes');
      const updated: E2ECalendarEvent = {
        ...existing,
        ...(nextTitle ? { title: nextTitle } : {}),
        startDate: nextStartDate,
        endDate: nextEndDate,
        ...(nextLocation !== undefined ? { location: nextLocation } : {}),
        ...(nextNotes !== undefined ? { notes: nextNotes } : {}),
        ...(typeof args.allDay === 'boolean' ? { allDay: args.allDay } : {}),
      };
      if (e2eCalendarEventsEqual(existing, updated)) {
        return completedE2ENativeOutcome({
          status: 'updated_verified',
          eventId,
          event: serializeE2ECalendarEvent(existing),
          idempotent: true,
        });
      }
      e2eCalendarEvents[eventIndex] = updated;
      state.updatedEventCount += 1;
      state.lastUpdatedEventId = updated.id;
      state.lastUpdatedStartDate = updated.startDate;
      state.lastUpdatedEndDate = updated.endDate;
      if (e2eLastCreatedCalendarEventId === updated.id) {
        recordLastCreatedCalendarTiming(state, updated);
      }
      return completedE2ENativeOutcome({
        status: 'updated_verified',
        eventId,
        event: serializeE2ECalendarEvent(updated),
      });
    }
    default:
      return null;
  }
}
