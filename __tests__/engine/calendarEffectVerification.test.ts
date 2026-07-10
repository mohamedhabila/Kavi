import {
  executeCalendarCreate,
  executeCalendarUpdate,
  type CalendarMutationRuntime,
} from '../../src/engine/tools/native/calendar/executor';
import { resolveToolEffectCompletionRequirement } from '../../src/engine/toolExecution/toolEffectCompletionContract';
import { buildToolEffectReceipt } from '../../src/engine/toolExecution/toolEffectReceipt';

const mockRequestCalendarPermissionsAsync = jest.fn();
const mockGetCalendarsAsync = jest.fn();
const mockCreateEventAsync = jest.fn();
const mockUpdateEventAsync = jest.fn();
const mockGetEventAsync = jest.fn();

const calendarRuntime = {
  EntityTypes: { EVENT: 'event' },
  requestCalendarPermissionsAsync: mockRequestCalendarPermissionsAsync,
  getCalendarsAsync: mockGetCalendarsAsync,
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

    const result = JSON.parse(
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
    const resultText = await executeCalendarCreate(JSON.parse(argumentsText), calendarRuntime);

    expect(JSON.parse(resultText)).toMatchObject({
      status: 'created_unverified',
      eventId: 'event-1',
      verificationError: 'calendar_readback_mismatch',
    });
    await expect(
      buildToolEffectReceipt({
        toolCallId: 'tc-calendar',
        toolName: 'calendar_create_event',
        argumentsText,
        resultText,
        transportState: 'returned',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        effectState: 'applied',
        verificationState: 'acknowledged',
      }),
    );
  });

  it('reads an updated event back before returning verified completion', async () => {
    mockUpdateEventAsync.mockResolvedValue(undefined);
    mockGetEventAsync.mockResolvedValue({ id: 'event-1', title: 'Updated planning' });

    const result = JSON.parse(
      await executeCalendarUpdate(
        { id: 'event-1', title: 'Updated planning' },
        calendarRuntime,
      ),
    );

    expect(result).toMatchObject({ status: 'updated_verified', eventId: 'event-1' });
    expect(mockGetEventAsync).toHaveBeenCalledWith('event-1');
  });
});
