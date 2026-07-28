import {
  executeCalendarCreate,
  executeCalendarEvents,
  executeCalendarUpdate,
  type CalendarMutationRuntime,
} from '../../src/engine/tools/native/calendar/executor';
import { resolveToolEffectCompletionRequirement } from '../../src/engine/toolExecution/toolEffectCompletionContract';
import { buildToolEffectReceipt } from '../../src/engine/toolExecution/toolEffectReceipt';
import { failedToolContent, parseCompletedToolOutcome } from '../helpers/toolRuntimeOutcome';

const mockRequestCalendarPermissionsAsync = jest.fn();
const mockGetCalendarsAsync = jest.fn();
const mockGetEventsAsync = jest.fn();
const mockCreateEventAsync = jest.fn();
const mockUpdateEventAsync = jest.fn();
const mockGetEventAsync = jest.fn();

const calendarRuntime = {
  EntityTypes: { EVENT: 'event' },
  requestCalendarPermissionsAsync: mockRequestCalendarPermissionsAsync,
  getCalendarsAsync: mockGetCalendarsAsync,
  getEventsAsync: mockGetEventsAsync,
  createEventAsync: mockCreateEventAsync,
  updateEventAsync: mockUpdateEventAsync,
  getEventAsync: mockGetEventAsync,
} as unknown as CalendarMutationRuntime;

describe('calendar effect verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestCalendarPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetCalendarsAsync.mockResolvedValue([
      { id: 'calendar-1', isPrimary: true, allowsModifications: true },
    ]);
  });

  it('reads a created event back before returning verified completion', async () => {
    const startDate = '2026-07-11T09:00:00.000Z';
    const endDate = '2026-07-11T10:00:00.000Z';
    mockCreateEventAsync.mockResolvedValue('event-1');
    mockGetEventAsync.mockResolvedValue({
      id: 'event-1',
      title: 'Planning',
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      allDay: false,
    });

    const result = parseCompletedToolOutcome(
      await executeCalendarCreate({ title: 'Planning', startDate, endDate }, calendarRuntime),
    );

    expect(result).toMatchObject({
      status: 'created_verified',
      eventId: 'event-1',
      calendarId: 'calendar-1',
    });
    expect(mockGetEventAsync).toHaveBeenCalledWith('event-1');
    await expect(
      resolveToolEffectCompletionRequirement({
        toolName: 'calendar_create_event',
        argumentsText: JSON.stringify({ title: 'Planning', startDate, endDate }),
      }),
    ).resolves.toEqual(expect.objectContaining({ kind: 'effectful' }));
  });

  it('returns an applied acknowledgement when create readback does not match', async () => {
    const argumentsText = JSON.stringify({
      title: 'Planning',
      startDate: '2026-07-11T09:00:00.000Z',
      endDate: '2026-07-11T10:00:00.000Z',
    });
    mockCreateEventAsync.mockResolvedValue('event-1');
    mockGetEventAsync.mockResolvedValue({
      id: 'event-1',
      title: 'Different event',
      startDate: new Date('2026-07-11T09:00:00.000Z'),
      endDate: new Date('2026-07-11T10:00:00.000Z'),
      allDay: false,
    });
    const outcome = await executeCalendarCreate(JSON.parse(argumentsText), calendarRuntime);
    const result = parseCompletedToolOutcome(outcome);
    const resultText = JSON.stringify(result);

    expect(result).toMatchObject({
      status: 'created_unverified',
      eventId: 'event-1',
      verificationError: 'calendar_readback_mismatch',
    });
    await expect(
      buildToolEffectReceipt({
        executionRunId: 'execution-run-1',
        toolCallId: 'tc-calendar',
        toolName: 'calendar_create_event',
        argumentsText,
        resultText,
        transportState: 'returned',
        resultIsError: outcome.status === 'failed',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        effectState: 'applied',
        verificationState: 'acknowledged',
      }),
    );
  });

  it('records a missing writable calendar as a definitive no-effect failure', async () => {
    const argumentsText = JSON.stringify({
      title: 'Planning',
      startDate: '2026-07-11T09:00:00.000Z',
      endDate: '2026-07-11T10:00:00.000Z',
    });
    mockGetCalendarsAsync.mockResolvedValue([]);

    const outcome = await executeCalendarCreate(JSON.parse(argumentsText), calendarRuntime);
    const resultText = failedToolContent(outcome);

    expect(JSON.parse(resultText)).toMatchObject({
      status: 'not_found',
      error: 'No writable calendar found on this device. Please create a calendar first.',
    });
    expect(mockCreateEventAsync).not.toHaveBeenCalled();
    await expect(
      buildToolEffectReceipt({
        executionRunId: 'execution-run-1',
        toolCallId: 'tc-calendar-missing',
        toolName: 'calendar_create_event',
        argumentsText,
        resultText,
        transportState: 'returned',
        resultIsError: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        effectState: 'failed',
        verificationState: 'unverified',
      }),
    );
  });

  it('keeps a mutation exception uncertain because dispatch may have occurred', async () => {
    const argumentsText = JSON.stringify({
      title: 'Planning',
      startDate: '2026-07-11T09:00:00.000Z',
      endDate: '2026-07-11T10:00:00.000Z',
    });
    mockCreateEventAsync.mockRejectedValue(new Error('Provider connection lost'));

    const outcome = await executeCalendarCreate(JSON.parse(argumentsText), calendarRuntime);
    const resultText = failedToolContent(outcome);

    expect(JSON.parse(resultText)).toMatchObject({ status: 'unknown' });
    await expect(
      buildToolEffectReceipt({
        executionRunId: 'execution-run-1',
        toolCallId: 'tc-calendar-uncertain',
        toolName: 'calendar_create_event',
        argumentsText,
        resultText,
        transportState: 'returned',
        resultIsError: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        effectState: 'unknown',
        verificationState: 'unverified',
      }),
    );
  });

  it('reads an updated event back before returning verified completion', async () => {
    mockUpdateEventAsync.mockResolvedValue(undefined);
    mockGetEventAsync
      .mockResolvedValueOnce({
        id: 'event-1',
        calendarId: 'calendar-1',
        title: 'Planning',
        location: 'Room 1',
        notes: 'Bring notes',
        startDate: new Date('2026-07-11T09:00:00.000Z'),
        endDate: new Date('2026-07-11T10:00:00.000Z'),
        allDay: false,
        availability: 'busy',
        alarms: [],
      })
      .mockResolvedValueOnce({
        id: 'event-1',
        calendarId: 'calendar-1',
        title: 'Updated planning',
        location: 'Room 1',
        notes: 'Bring notes',
        startDate: new Date('2026-07-11T09:00:00.000Z'),
        endDate: new Date('2026-07-11T10:00:00.000Z'),
        allDay: false,
        availability: 'busy',
        alarms: [],
      });

    const result = parseCompletedToolOutcome(
      await executeCalendarUpdate({ id: 'event-1', title: 'Updated planning' }, calendarRuntime),
    );

    expect(result).toMatchObject({ status: 'updated_verified', eventId: 'event-1' });
    expect(mockGetEventAsync).toHaveBeenCalledTimes(2);
    expect(mockUpdateEventAsync).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({
        title: 'Updated planning',
        location: 'Room 1',
        notes: 'Bring notes',
        allDay: false,
        availability: 'busy',
        alarms: [],
      }),
    );
  });

  it('preserves unrelated fields for a date-only update and verifies them after saving', async () => {
    const newStart = '2026-07-11T11:15:00.000Z';
    const newEnd = '2026-07-11T11:45:00.000Z';
    const existing = {
      id: 'event-1',
      calendarId: 'calendar-1',
      title: 'Planning',
      location: 'Room 1',
      notes: 'Bring notes',
      timeZone: 'Europe/Amsterdam',
      startDate: new Date('2026-07-11T09:00:00.000Z'),
      endDate: new Date('2026-07-11T10:00:00.000Z'),
      allDay: false,
      availability: 'busy',
      alarms: [],
    };
    mockUpdateEventAsync.mockResolvedValue(undefined);
    mockGetEventAsync
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({
        ...existing,
        startDate: new Date(newStart),
        endDate: new Date(newEnd),
      });

    const result = parseCompletedToolOutcome(
      await executeCalendarUpdate(
        { id: 'event-1', startDate: newStart, endDate: newEnd },
        calendarRuntime,
      ),
    );

    expect(result).toMatchObject({ status: 'updated_verified', eventId: 'event-1' });
    expect(mockUpdateEventAsync).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({
        title: 'Planning',
        location: 'Room 1',
        notes: 'Bring notes',
        startDate: new Date(newStart),
        endDate: new Date(newEnd),
        allDay: false,
        availability: 'busy',
        alarms: [],
      }),
    );
  });

  it('rejects an update that contains only an event id', async () => {
    const result = JSON.parse(
      failedToolContent(await executeCalendarUpdate({ id: 'event-1' }, calendarRuntime)),
    );

    expect(result).toEqual({
      status: 'invalid_request',
      error: 'Calendar update requires at least one field to change.',
    });
    expect(mockGetEventAsync).not.toHaveBeenCalled();
    expect(mockUpdateEventAsync).not.toHaveBeenCalled();
  });

  it('does not report verified success when an unrelated field is lost', async () => {
    const existing = {
      id: 'event-1',
      title: 'Planning',
      location: '',
      notes: '',
      startDate: new Date('2026-07-11T09:00:00.000Z'),
      endDate: new Date('2026-07-11T10:00:00.000Z'),
      allDay: false,
      availability: 'busy',
      alarms: [],
    };
    mockUpdateEventAsync.mockResolvedValue(undefined);
    mockGetEventAsync
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ ...existing, title: '' });

    const result = parseCompletedToolOutcome(
      await executeCalendarUpdate(
        { id: 'event-1', startDate: '2026-07-11T09:30:00.000Z' },
        calendarRuntime,
      ),
    );

    expect(result).toMatchObject({
      status: 'updated_unverified',
      eventId: 'event-1',
      verificationError: 'calendar_readback_mismatch',
    });
  });

  it('treats absent and empty optional text as the same persisted calendar value', async () => {
    const existing = {
      id: 'event-1',
      title: '',
      startDate: new Date('2026-07-11T09:00:00.000Z'),
      endDate: new Date('2026-07-11T10:00:00.000Z'),
      allDay: false,
      availability: 'busy',
      alarms: [],
    };
    mockUpdateEventAsync.mockResolvedValue(undefined);
    mockGetEventAsync
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ ...existing, title: 'Restored title' });

    const result = parseCompletedToolOutcome(
      await executeCalendarUpdate(
        { id: 'event-1', title: 'Restored title' },
        calendarRuntime,
      ),
    );

    expect(result).toMatchObject({ status: 'updated_verified', eventId: 'event-1' });
  });

  it('resolves all event calendar ids when a calendar filter is omitted', async () => {
    mockGetCalendarsAsync.mockResolvedValue([
      { id: 'calendar-1' },
      { id: 'calendar-2' },
      { id: '' },
    ]);
    mockGetEventsAsync.mockResolvedValue([]);

    const result = parseCompletedToolOutcome(
      await executeCalendarEvents(
        { startDate: '2026-07-11T00:00:00.000Z', endDate: '2026-07-12T00:00:00.000Z' },
        calendarRuntime,
      ),
    );

    expect(result).toEqual([]);
    expect(mockGetEventsAsync).toHaveBeenCalledWith(
      ['calendar-1', 'calendar-2'],
      new Date('2026-07-11T00:00:00.000Z'),
      new Date('2026-07-12T00:00:00.000Z'),
    );
  });
});
