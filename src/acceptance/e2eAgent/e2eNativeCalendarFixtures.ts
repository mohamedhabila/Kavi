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
