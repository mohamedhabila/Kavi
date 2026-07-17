import {
  E2E_FIXTURE_DEVICE_HEALTH_JSON,
  E2E_FIXTURE_DEVICE_INFO_JSON,
  E2E_FIXTURE_DEVICE_PERMISSIONS_JSON,
  E2E_FIXTURE_DEVICE_STATUS_JSON,
  E2E_FIXTURE_CALENDAR_EVENTS_JSON,
  E2E_FIXTURE_CALENDAR_LIST_JSON,
  getE2ENativeMobileFixtureStateSnapshot,
  getE2ENativeMobileInvocationSnapshots,
  resetE2ENativeMobileFixtures,
  tryExecuteE2ENativeCalendarTool,
  tryExecuteE2ENativeMobileTool,
} from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import { installNativeToolExecutionEnvironment } from '../../src/engine/tools/native/executionEnvironment';
import { executeToolInner } from '../../src/engine/tools/toolDispatchRouter';
import { parseCompletedToolOutcome } from '../helpers/toolRuntimeOutcome';

describe('E2E native mobile fixtures', () => {
  let uninstallEnvironment: () => void;

  beforeEach(() => {
    resetE2ENativeMobileFixtures();
    uninstallEnvironment = installNativeToolExecutionEnvironment({
      tryExecute: ({ name, argsString }) => tryExecuteE2ENativeMobileTool(name, argsString),
    });
  });

  afterEach(() => {
    uninstallEnvironment();
  });

  it('returns deterministic calendar_list JSON at the dispatch seam', async () => {
    const outcome = await tryExecuteE2ENativeCalendarTool('calendar_list', '{}');
    expect(outcome).toEqual({ status: 'completed', content: E2E_FIXTURE_CALENDAR_LIST_JSON });
    const parsed = JSON.parse(outcome!.content) as Array<{ allowsModifications: boolean }>;
    expect(parsed[0]?.allowsModifications).toBe(true);
  });

  it('returns deterministic empty calendar_events JSON at the dispatch seam', async () => {
    const outcome = await tryExecuteE2ENativeCalendarTool(
      'calendar_events',
      JSON.stringify({
        startDate: '2026-06-10T00:00:00Z',
        endDate: '2026-06-11T00:00:00Z',
      }),
    );
    expect(outcome).toEqual({ status: 'completed', content: E2E_FIXTURE_CALENDAR_EVENTS_JSON });
    expect(JSON.parse(outcome!.content)).toEqual([]);
    expect(getE2ENativeMobileFixtureStateSnapshot().calendar.listed).toBe(true);
  });

  it('records argument-free before and after evidence for native invocations', async () => {
    await tryExecuteE2ENativeMobileTool(
      'clipboard_write',
      JSON.stringify({ text: 'PRIVATE-NATIVE-ARGUMENT' }),
    );

    const invocations = getE2ENativeMobileInvocationSnapshots();
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      sequence: 1,
      toolName: 'clipboard_write',
      handled: true,
      resultStatus: 'written_verified',
      errorClass: null,
      stateBefore: { clipboard: { text: '', writeCount: 0 } },
      stateAfter: { clipboard: { text: 'PRIVATE-NATIVE-ARGUMENT', writeCount: 1 } },
    });
    expect(invocations[0]).not.toHaveProperty('argsString');

    resetE2ENativeMobileFixtures();
    expect(getE2ENativeMobileInvocationSnapshots()).toEqual([]);
  });

  it('routes calendar_list through executeToolInner without touching native executors', async () => {
    const outcome = await executeToolInner('calendar_list', '{}', 'conv-calendar-e2e');
    expect(outcome).toEqual({ status: 'completed', content: E2E_FIXTURE_CALENDAR_LIST_JSON });
  });

  it('returns deterministic permission-state fixtures for mobile-native benchmarks', async () => {
    const outcome = await tryExecuteE2ENativeMobileTool('device_permissions', '{}');
    expect(outcome).toEqual({
      status: 'completed',
      content: E2E_FIXTURE_DEVICE_PERMISSIONS_JSON,
    });
    const parsed = JSON.parse(outcome!.content);
    expect(parsed.version).toBe('native-tools-2026-07-10');
    expect(parsed.states.denied.location.status).toBe('denied');
    expect(parsed.states.askEveryTime.camera.scope).toBe('ephemeral');
    expect(parsed.states.unavailable.screenCapture.status).toBe('unavailable');
    expect(parsed.states.revokedMidTask.mediaLibrary.status).toBe('revoked');
  });

  it.each([
    ['status', E2E_FIXTURE_DEVICE_STATUS_JSON],
    ['info', E2E_FIXTURE_DEVICE_INFO_JSON],
    ['health', E2E_FIXTURE_DEVICE_HEALTH_JSON],
    ['permissions', E2E_FIXTURE_DEVICE_PERMISSIONS_JSON],
  ])(
    'routes deterministic device_query %s evidence without loading Expo modules',
    async (kind, expected) => {
      const outcome = await executeToolInner(
        'device_query',
        JSON.stringify({ kind }),
        'conv-mobile-device-e2e',
      );

      expect(outcome).toEqual({ status: 'completed', content: expected });
      expect(JSON.parse(outcome.content)).not.toHaveProperty('error');
    },
  );

  it('uses status evidence when the canonical device query omits kind', async () => {
    const outcome = await executeToolInner('device_query', '{}', 'conv-mobile-device-default-e2e');

    expect(outcome).toEqual({ status: 'completed', content: E2E_FIXTURE_DEVICE_STATUS_JSON });
  });

  it('routes mobile-native fixtures through executeToolInner with state evidence', async () => {
    const writeRaw = await executeToolInner(
      'clipboard_write',
      JSON.stringify({ text: 'E2E-CLIPBOARD-42' }),
      'conv-mobile-e2e',
    );
    expect(parseCompletedToolOutcome(writeRaw)).toEqual({
      status: 'written_verified',
      characterCount: 16,
      verified: true,
    });

    const readRaw = await executeToolInner('clipboard_read', '{}', 'conv-mobile-e2e');
    expect(parseCompletedToolOutcome(readRaw)).toEqual({
      status: 'read',
      text: 'E2E-CLIPBOARD-42',
      empty: false,
    });
  });

  it('routes calendar mutation and maps fixtures through executeToolInner', async () => {
    const invalidCreateRaw = await executeToolInner(
      'calendar_create_event',
      JSON.stringify({
        startDate: '2026-06-12T10:00:00Z',
        endDate: '2026-06-12T11:00:00Z',
      }),
      'conv-mobile-calendar-e2e',
    );
    expect(invalidCreateRaw.status).toBe('failed');
    expect(JSON.parse(invalidCreateRaw.content)).toEqual({
      status: 'error',
      code: 'missing_required_argument',
      tool: 'calendar_create_event',
      missingRequiredArguments: ['title'],
      error: 'Missing required argument: title',
    });
    expect(getE2ENativeMobileFixtureStateSnapshot().calendar.createdEventCount).toBe(0);

    const createRaw = await executeToolInner(
      'calendar_create_event',
      JSON.stringify({
        title: 'E2E Native Review',
        startDate: '2026-06-12T10:00:00Z',
        endDate: '2026-06-12T10:45:00Z',
      }),
      'conv-mobile-calendar-e2e',
    );
    const created = parseCompletedToolOutcome(createRaw);
    expect(created).toEqual(
      expect.objectContaining({
        status: 'created_verified',
        eventId: 'e2e-event-1',
      }),
    );

    const updateRaw = await executeToolInner(
      'calendar_update_event',
      JSON.stringify({ id: created.eventId, title: 'Updated Review' }),
      'conv-mobile-calendar-e2e',
    );
    expect(parseCompletedToolOutcome(updateRaw)).toEqual({
      status: 'updated_verified',
      eventId: 'e2e-event-1',
      event: expect.objectContaining({
        id: 'e2e-event-1',
        title: 'Updated Review',
      }),
    });

    const duplicateUpdateRaw = await executeToolInner(
      'calendar_update_event',
      JSON.stringify({ id: created.eventId, title: 'Updated Review' }),
      'conv-mobile-calendar-e2e',
    );
    expect(parseCompletedToolOutcome(duplicateUpdateRaw)).toEqual({
      status: 'updated_verified',
      eventId: 'e2e-event-1',
      idempotent: true,
      event: expect.objectContaining({
        id: 'e2e-event-1',
        title: 'Updated Review',
      }),
    });
    expect(getE2ENativeMobileFixtureStateSnapshot().calendar.updatedEventCount).toBe(1);
    expect(getE2ENativeMobileFixtureStateSnapshot().calendar).toMatchObject({
      lastCreatedEventId: 'e2e-event-1',
      lastCreatedTitle: 'Updated Review',
      lastCreatedStartDate: '2026-06-12T10:00:00.000Z',
      lastCreatedEndDate: '2026-06-12T10:45:00.000Z',
      lastCreatedDurationMinutes: 45,
    });

    const mapsRaw = await executeToolInner(
      'maps_open',
      JSON.stringify({ query: 'E2E Station' }),
      'conv-mobile-calendar-e2e',
    );
    expect(parseCompletedToolOutcome(mapsRaw)).toEqual({
      status: 'maps_opened',
      targetKind: 'query',
    });
  });

  it('persists created and updated calendar events for verification reads', async () => {
    const createRaw = await executeToolInner(
      'calendar_create_event',
      JSON.stringify({
        calendarId: 'e2e-cal-1',
        title: 'AndroidWorld Direct Review',
        startDate: '2026-06-12T10:00:00Z',
        endDate: '2026-06-12T11:00:00Z',
        location: 'Room A',
      }),
      'conv-mobile-calendar-e2e',
    );
    const created = parseCompletedToolOutcome(createRaw);
    expect(created).toEqual(
      expect.objectContaining({
        status: 'created_verified',
        eventId: 'e2e-event-1',
        event: expect.objectContaining({
          title: 'AndroidWorld Direct Review',
          location: 'Room A',
        }),
      }),
    );

    const updateRaw = await executeToolInner(
      'calendar_update_event',
      JSON.stringify({
        id: created.eventId,
        title: 'AndroidWorld Direct Review Updated',
        notes: 'verified',
      }),
      'conv-mobile-calendar-e2e',
    );
    expect(parseCompletedToolOutcome(updateRaw)).toEqual(
      expect.objectContaining({
        status: 'updated_verified',
        eventId: 'e2e-event-1',
        event: expect.objectContaining({
          title: 'AndroidWorld Direct Review Updated',
          notes: 'verified',
        }),
      }),
    );

    const eventsRaw = await executeToolInner(
      'calendar_events',
      JSON.stringify({
        calendarId: 'e2e-cal-1',
        startDate: '2026-06-12T00:00:00Z',
        endDate: '2026-06-13T00:00:00Z',
      }),
      'conv-mobile-calendar-e2e',
    );
    expect(parseCompletedToolOutcome(eventsRaw)).toEqual([
      expect.objectContaining({
        id: 'e2e-event-1',
        calendarId: 'e2e-cal-1',
        title: 'AndroidWorld Direct Review Updated',
        location: 'Room A',
        notes: 'verified',
      }),
    ]);
    expect(getE2ENativeMobileFixtureStateSnapshot().calendar).toMatchObject({
      lastCreatedStartDate: '2026-06-12T10:00:00.000Z',
      lastCreatedEndDate: '2026-06-12T11:00:00.000Z',
      lastCreatedDurationMinutes: 60,
    });
  });

  it('returns contacts with phone numbers usable by SMS composition', async () => {
    const contactsRaw = await executeToolInner(
      'contacts_search',
      JSON.stringify({ query: 'Avery' }),
      'conv-mobile-contact-e2e',
    );
    expect(parseCompletedToolOutcome(contactsRaw)).toEqual([
      expect.objectContaining({
        id: 'e2e-contact-avery',
        phoneNumbers: [expect.objectContaining({ number: '+15550101001' })],
      }),
    ]);
    const smsRaw = await executeToolInner(
      'sms_compose',
      JSON.stringify({
        recipients: ['+15550101001'],
        message: 'Hello Avery',
      }),
      'conv-mobile-contact-e2e',
    );
    expect(parseCompletedToolOutcome(smsRaw)).toEqual({
      status: 'sms_composer_opened',
      recipientCount: 1,
      messageLength: 11,
    });
    expect(getE2ENativeMobileFixtureStateSnapshot().sms).toEqual({
      opened: true,
      recipientCount: 1,
      messageLength: 11,
    });
  });

  it('rejects non-phone SMS recipients without mutating fixture state', async () => {
    const raw = await executeToolInner(
      'sms_compose',
      JSON.stringify({
        recipients: ['Avery'],
        message: 'Hello Avery',
      }),
      'conv-mobile-contact-e2e',
    );

    expect(raw.status).toBe('failed');
    expect(JSON.parse(raw.content)).toEqual({
      status: 'error',
      code: 'invalid_phone_number',
      tool: 'sms_compose',
      error:
        'recipients[0]: Phone numbers must be valid international numbers or include a valid defaultCountry.',
    });
    expect(getE2ENativeMobileFixtureStateSnapshot().sms).toEqual({
      opened: false,
      recipientCount: 0,
      messageLength: 0,
    });
  });

  it('routes notification schedule and cancel fixtures through executeToolInner', async () => {
    const scheduleRaw = await executeToolInner(
      'notification_schedule',
      JSON.stringify({ title: 'E2E', body: 'Ping', delaySeconds: 60 }),
      'conv-mobile-notification-e2e',
    );
    const scheduled = parseCompletedToolOutcome(scheduleRaw);
    expect(scheduled.status).toBe('notification_scheduled');

    const cancelRaw = await executeToolInner(
      'notification_cancel',
      JSON.stringify({ id: scheduled.id }),
      'conv-mobile-notification-e2e',
    );
    expect(parseCompletedToolOutcome(cancelRaw)).toEqual({
      status: 'notification_cancelled',
      id: 'e2e-notification-scheduled',
      cancelled: true,
    });
  });

  it('returns structural permission-denied evidence without marking the tool result as malformed', async () => {
    const raw = await executeToolInner('location_current', '{}', 'conv-mobile-permission-e2e');
    expect(raw.status).toBe('failed');
    expect(JSON.parse(raw.content)).toEqual(
      expect.objectContaining({
        status: 'permission_denied',
        code: 'permission_denied',
      }),
    );
  });
});
