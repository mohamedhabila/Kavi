import {
  CALENDAR_CREATE_TOOL,
  CALENDAR_UPDATE_TOOL,
} from '../../../../../src/engine/tools/native/calendar/definitions';
import {
  executeCalendarCreate,
  type CalendarMutationRuntime,
} from '../../../../../src/engine/tools/native/calendar/executor';

const mockCreateEventAsync = jest.fn();
const mockGetEventAsync = jest.fn();

const calendarRuntime = {
  EntityTypes: { EVENT: 'event' },
  requestCalendarPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCalendarsAsync: jest
    .fn()
    .mockResolvedValue([{ id: 'calendar-1', isPrimary: true, allowsModifications: true }]),
  getEventsAsync: jest.fn(),
  createEventAsync: mockCreateEventAsync,
  updateEventAsync: jest.fn(),
  getEventAsync: mockGetEventAsync,
} as unknown as CalendarMutationRuntime;

describe('calendar time contract', () => {
  // A model shown only offset-less examples converted a flight's UTC times to local time
  // itself and got them wrong in 2 of 6 live runs; copying the stated zone removes that step.
  it.each([CALENDAR_CREATE_TOOL, CALENDAR_UPDATE_TOOL])(
    '$name tells the model to keep the zone a time was given in',
    (tool) => {
      expect(tool.description).toContain('2026-05-04T09:15:00Z');
      expect(tool.description).toContain('never convert it yourself');
      expect(tool.description).toContain('A plan in the device timezone has no offset');
    },
  );

  it('creates the event at the exact instants a copied zone names', async () => {
    mockCreateEventAsync.mockResolvedValue('event-1');
    mockGetEventAsync.mockResolvedValue(null);

    await executeCalendarCreate(
      {
        title: 'Flight to Lisbon',
        startDate: '2026-05-04T09:15:00Z',
        endDate: '2026-05-04T12:00:00+01:00',
      },
      calendarRuntime,
    );

    const [, details] = mockCreateEventAsync.mock.calls[0];
    expect((details.startDate as Date).toISOString()).toBe('2026-05-04T09:15:00.000Z');
    expect((details.endDate as Date).toISOString()).toBe('2026-05-04T11:00:00.000Z');
  });
});
