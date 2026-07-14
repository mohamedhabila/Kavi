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
