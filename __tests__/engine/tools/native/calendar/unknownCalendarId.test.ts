import {
  executeCalendarCreate,
  executeCalendarEvents,
  type CalendarMutationRuntime,
} from '../../../../../src/engine/tools/native/calendar/executor';
import { parseCompletedToolOutcome } from '../../../../helpers/toolRuntimeOutcome';

const getEventsAsync = jest.fn();
const createEventAsync = jest.fn();
const getEventAsync = jest.fn();

const runtime = {
  EntityTypes: { EVENT: 'event' },
  requestCalendarPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCalendarsAsync: jest.fn(async () => [
    { id: 'home', title: 'Home', isPrimary: true, allowsModifications: true },
    { id: 'work', title: 'Work', isPrimary: false, allowsModifications: true },
  ]),
  getEventsAsync,
  createEventAsync,
  updateEventAsync: jest.fn(),
  getEventAsync,
} as unknown as CalendarMutationRuntime;

const window = { startDate: '2026-10-19T00:00:00.000Z', endDate: '2026-10-26T00:00:00.000Z' };
const dentist = {
  id: 'e-1',
  title: 'Dentist',
  startDate: '2026-10-20T10:00:00.000Z',
  endDate: '2026-10-20T11:00:00.000Z',
  location: 'Rua Augusta 274',
  allDay: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  getEventsAsync.mockResolvedValue([dentist]);
});

// GLM passed calendarId "primary" (a Google Calendar convention): the phone has no such
// calendar, so the search came back empty and it asked the person for an address that was
// on their calendar (pw-calendar-address-to-sms 0/3, pw-book-free-hour 1/3).
describe('a calendar id the phone does not have', () => {
  it('searches every calendar for events and says so', async () => {
    const outcome = await executeCalendarEvents({ ...window, calendarId: 'primary' }, runtime);

    expect(getEventsAsync).toHaveBeenCalledWith(
      ['home', 'work'],
      expect.any(Date),
      expect.any(Date),
    );
    expect(parseCompletedToolOutcome(outcome)).toEqual({
      events: [expect.objectContaining({ id: 'e-1', location: 'Rua Augusta 274' })],
      note: expect.stringContaining('"primary"'),
    });
  });

  it('creates the event in the default calendar and says so', async () => {
    createEventAsync.mockResolvedValue('new-1');
    getEventAsync.mockResolvedValue({
      id: 'new-1',
      title: 'Budget sync',
      startDate: new Date('2026-10-22T16:00:00.000Z'),
      endDate: new Date('2026-10-22T17:00:00.000Z'),
      allDay: false,
    });

    const outcome = await executeCalendarCreate(
      {
        title: 'Budget sync',
        startDate: '2026-10-22T16:00:00.000Z',
        endDate: '2026-10-22T17:00:00.000Z',
        calendarId: 'primary',
        allDay: false,
      },
      runtime,
    );

    expect(createEventAsync).toHaveBeenCalledWith('home', expect.any(Object));
    expect(parseCompletedToolOutcome(outcome)).toMatchObject({
      status: 'created_verified',
      calendarId: 'home',
      note: expect.stringContaining('default calendar, Home'),
    });
  });
});

describe('a calendar id the phone has, or none', () => {
  it('searches only the calendar named', async () => {
    const outcome = await executeCalendarEvents({ ...window, calendarId: 'work' }, runtime);

    expect(getEventsAsync).toHaveBeenCalledWith(['work'], expect.any(Date), expect.any(Date));
    expect(parseCompletedToolOutcome(outcome)).toEqual([expect.objectContaining({ id: 'e-1' })]);
  });

  it('searches every calendar when none is named', async () => {
    const outcome = await executeCalendarEvents(window, runtime);

    expect(getEventsAsync).toHaveBeenCalledWith(
      ['home', 'work'],
      expect.any(Date),
      expect.any(Date),
    );
    expect(parseCompletedToolOutcome(outcome)).toEqual([expect.objectContaining({ id: 'e-1' })]);
  });

  it('creates the event in the calendar named, without a note', async () => {
    createEventAsync.mockResolvedValue('new-2');
    getEventAsync.mockResolvedValue(null);

    const outcome = await executeCalendarCreate(
      {
        title: 'Standup',
        startDate: '2026-10-22T09:00:00.000Z',
        endDate: '2026-10-22T09:15:00.000Z',
        calendarId: 'work',
        allDay: false,
      },
      runtime,
    );

    expect(createEventAsync).toHaveBeenCalledWith('work', expect.any(Object));
    expect(parseCompletedToolOutcome(outcome)).not.toHaveProperty('note');
  });
});
