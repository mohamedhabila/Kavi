// ---------------------------------------------------------------------------
// Kavi — E2E native mobile fixtures (dispatch seam)
// ---------------------------------------------------------------------------
// Node live E2E lacks Expo native modules. Fixtures inject at dispatch, not in
// device executors, so benchmark runs still exercise normal tool routing.

import { ALL_NATIVE_TOOL_DEFINITIONS } from './native/definitions';
import { normalizePhoneNumberList } from '../../services/nativeActions/builders/phone';

export function isE2EAgentEvalRuntime(): boolean {
  return process.env.RUN_E2E_AGENT_EVAL === '1';
}

/** Deterministic calendar list for live E2E (Node lacks expo-calendar). */
export const E2E_FIXTURE_CALENDAR_LIST_JSON = JSON.stringify([
  {
    id: 'e2e-cal-1',
    title: 'E2E Calendar',
    source: 'e2e',
    color: '#3366ff',
    allowsModifications: true,
  },
]);

/** Deterministic empty events payload for live E2E. */
export const E2E_FIXTURE_CALENDAR_EVENTS_JSON = JSON.stringify([]);

export const E2E_NATIVE_PERMISSION_STATES = {
  granted: {
    calendar: { status: 'granted', canAskAgain: true },
    contacts: { status: 'granted', canAskAgain: true, accessPrivileges: 'all' },
    notifications: { status: 'granted', canAskAgain: true },
  },
  denied: {
    location: { status: 'denied', canAskAgain: true },
  },
  askEveryTime: {
    camera: { status: 'granted', canAskAgain: true, scope: 'ephemeral' },
  },
  unavailable: {
    screenCapture: { status: 'unavailable', canAskAgain: false },
  },
  revokedMidTask: {
    mediaLibrary: { status: 'revoked', canAskAgain: true },
  },
} as const;

type E2ECalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  startDate: string;
  endDate: string;
  location?: string;
  notes?: string;
  allDay: boolean;
};

export const E2E_FIXTURE_DEVICE_PERMISSIONS_JSON = JSON.stringify({
  version: 'native-tools-2026-06-12',
  states: E2E_NATIVE_PERMISSION_STATES,
  current: {
    calendar: 'granted',
    contacts: 'granted',
    location: 'denied',
    camera: 'granted',
    mediaLibrary: 'revoked',
    notifications: 'granted',
    screenCapture: 'unavailable',
  },
});

function applyE2EPermissionFixtureState(): void {
  e2eNativeFixtureState.permissions.location =
    E2E_NATIVE_PERMISSION_STATES.denied.location.status;
  e2eNativeFixtureState.permissions.mediaLibrary =
    E2E_NATIVE_PERMISSION_STATES.revokedMidTask.mediaLibrary.status;
  e2eNativeFixtureState.permissions.screenCapture =
    E2E_NATIVE_PERMISSION_STATES.unavailable.screenCapture.status;
}

const E2E_CONTACTS = [
  {
    id: 'e2e-contact-avery',
    name: 'Avery Chen',
    phoneNumbers: [{ label: 'mobile', number: '+15550101001' }],
    emails: [{ label: 'work', email: 'avery@example.invalid' }],
  },
] as const;

export type E2ENativeMobileFixtureStateSnapshot = {
  calendar: {
    listed: boolean;
    allowsModifications: boolean;
    createdEventCount: number;
    updatedEventCount: number;
  };
  permissions: {
    location: string;
    mediaLibrary: string;
    screenCapture: string;
  };
  maps: {
    opened: boolean;
    targetKind: string;
  };
  contacts: {
    resultCount: number;
    lastQuery: string;
  };
  sms: {
    opened: boolean;
    recipientCount: number;
    messageLength: number;
  };
  clipboard: {
    text: string;
    readCount: number;
    writeCount: number;
  };
  share: {
    opened: boolean;
    kind: string;
    textLength: number;
  };
  notification: {
    displayed: boolean;
    scheduled: boolean;
    cancelled: boolean;
    delaySeconds: number;
  };
  media: {
    photoCount: number;
    screenStatus: string;
    screenBase64Length: number;
    cameraStatus: string;
    cameraDuration: number;
  };
};

function createEmptyNativeFixtureState(): E2ENativeMobileFixtureStateSnapshot {
  return {
    calendar: {
      listed: false,
      allowsModifications: false,
      createdEventCount: 0,
      updatedEventCount: 0,
    },
    permissions: {
      location: '',
      mediaLibrary: '',
      screenCapture: '',
    },
    maps: {
      opened: false,
      targetKind: '',
    },
    contacts: {
      resultCount: 0,
      lastQuery: '',
    },
    sms: {
      opened: false,
      recipientCount: 0,
      messageLength: 0,
    },
    clipboard: {
      text: '',
      readCount: 0,
      writeCount: 0,
    },
    share: {
      opened: false,
      kind: '',
      textLength: 0,
    },
    notification: {
      displayed: false,
      scheduled: false,
      cancelled: false,
      delaySeconds: 0,
    },
    media: {
      photoCount: 0,
      screenStatus: '',
      screenBase64Length: 0,
      cameraStatus: '',
      cameraDuration: 0,
    },
  };
}

let e2eClipboardText = '';
let e2eCalendarEventId = 0;
let e2eCalendarEvents: E2ECalendarEvent[] = [];
let e2eNativeFixtureState = createEmptyNativeFixtureState();
const e2eNativeToolDefinitionsByName = new Map(
  ALL_NATIVE_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]),
);

function parseFixtureArgs(argsString: string): Record<string, unknown> {
  try {
    const parsed = argsString ? JSON.parse(argsString) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function buildMissingRequiredArgsError(name: string, missing: string[]): string {
  return JSON.stringify({
    status: 'error',
    code: 'missing_required_argument',
    tool: name,
    missingRequiredArguments: missing,
    error: `Missing required argument${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
  });
}

function buildInvalidFixtureArgsError(name: string, message: string, code = 'invalid_arguments'): string {
  return JSON.stringify({
    status: 'error',
    code,
    tool: name,
    error: message,
  });
}

function validateE2ENativeRequiredArgs(
  name: string,
  args: Record<string, unknown>,
): string | null {
  const definition = e2eNativeToolDefinitionsByName.get(name);
  const required = definition?.input_schema?.required;
  if (!Array.isArray(required) || required.length === 0) {
    return null;
  }

  const missing = required.filter((key) => {
    const value = args[key];
    if (value === undefined || value === null) {
      return true;
    }
    return typeof value === 'string' && value.trim().length === 0;
  });
  return missing.length > 0 ? buildMissingRequiredArgsError(name, missing) : null;
}

export function resetE2ENativeMobileFixtures(): void {
  e2eClipboardText = '';
  e2eCalendarEventId = 0;
  e2eCalendarEvents = [];
  e2eNativeFixtureState = createEmptyNativeFixtureState();
}

export function getE2ENativeMobileFixtureStateSnapshot(): E2ENativeMobileFixtureStateSnapshot {
  return JSON.parse(JSON.stringify(e2eNativeFixtureState)) as E2ENativeMobileFixtureStateSnapshot;
}

export async function tryExecuteE2ENativeCalendarTool(
  name: string,
  argsString: string,
): Promise<string | null> {
  if (!isE2EAgentEvalRuntime()) {
    return null;
  }

  const args = parseFixtureArgs(argsString);
  const validationError = validateE2ENativeRequiredArgs(name, args);
  if (validationError) {
    return validationError;
  }

  switch (name) {
    case 'calendar_list':
      e2eNativeFixtureState.calendar.listed = true;
      e2eNativeFixtureState.calendar.allowsModifications = true;
      return E2E_FIXTURE_CALENDAR_LIST_JSON;
    case 'calendar_events':
      e2eNativeFixtureState.calendar.listed = true;
      return JSON.stringify(readE2ECalendarEvents(args));
    default:
      return null;
  }
}

function readStringArg(
  args: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function readOptionalStringArg(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
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

export async function tryExecuteE2ENativeMobileTool(
  name: string,
  argsString: string,
): Promise<string | null> {
  if (!isE2EAgentEvalRuntime()) {
    return null;
  }

  const calendarResult = await tryExecuteE2ENativeCalendarTool(name, argsString);
  if (calendarResult !== null) {
    return calendarResult;
  }

  const args = parseFixtureArgs(argsString);
  const validationError = validateE2ENativeRequiredArgs(name, args);
  if (validationError) {
    return validationError;
  }

  switch (name) {
    case 'calendar_create_event': {
      e2eCalendarEventId += 1;
      e2eNativeFixtureState.calendar.createdEventCount += 1;
      const startDate = normalizeFixtureDate(args.startDate, '2026-06-12T10:00:00.000Z');
      const event: E2ECalendarEvent = {
        id: `e2e-event-${e2eCalendarEventId}`,
        calendarId: readStringArg(args, 'calendarId', 'e2e-cal-1'),
        title: readStringArg(args, 'title', `E2E Event ${e2eCalendarEventId}`),
        startDate,
        endDate: normalizeFixtureEndDate(
          startDate,
          args.endDate,
          '2026-06-12T11:00:00.000Z',
        ),
        ...(readOptionalStringArg(args, 'location')
          ? { location: readOptionalStringArg(args, 'location') }
          : {}),
        ...(readOptionalStringArg(args, 'notes')
          ? { notes: readOptionalStringArg(args, 'notes') }
          : {}),
        allDay: typeof args.allDay === 'boolean' ? args.allDay : false,
      };
      e2eCalendarEvents.push(event);
      return JSON.stringify({
        status: 'created',
        eventId: event.id,
        calendarId: event.calendarId,
        event: serializeE2ECalendarEvent(event),
      });
    }
    case 'calendar_update_event': {
      const eventId = readStringArg(args, 'id', 'e2e-event-1');
      const eventIndex = e2eCalendarEvents.findIndex((event) => event.id === eventId);
      if (eventIndex < 0) {
        return JSON.stringify({
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
        return JSON.stringify({
          status: 'unchanged',
          eventId,
          event: serializeE2ECalendarEvent(existing),
          idempotent: true,
        });
      }
      e2eCalendarEvents[eventIndex] = updated;
      e2eNativeFixtureState.calendar.updatedEventCount += 1;
      return JSON.stringify({
        status: 'updated',
        eventId,
        event: serializeE2ECalendarEvent(updated),
      });
    }
    case 'maps_open': {
      const targetKind =
        typeof args.latitude === 'number' && typeof args.longitude === 'number'
          ? 'coordinates'
          : 'query';
      e2eNativeFixtureState.maps.opened = true;
      e2eNativeFixtureState.maps.targetKind = targetKind;
      return JSON.stringify({
        status: 'maps_opened',
        targetKind,
      });
    }
    case 'device_permissions':
      applyE2EPermissionFixtureState();
      return E2E_FIXTURE_DEVICE_PERMISSIONS_JSON;
    case 'device_query': {
      const kind = typeof args.kind === 'string' ? args.kind.toLowerCase() : '';
      if (kind !== 'permissions') {
        return null;
      }
      applyE2EPermissionFixtureState();
      return E2E_FIXTURE_DEVICE_PERMISSIONS_JSON;
    }
    case 'location_current':
      return JSON.stringify({
        status: 'permission_denied',
        code: 'permission_denied',
        permission: E2E_NATIVE_PERMISSION_STATES.denied.location,
      });
    case 'contacts_search':
    case 'contacts_search_full':
      e2eNativeFixtureState.contacts.resultCount = E2E_CONTACTS.length;
      e2eNativeFixtureState.contacts.lastQuery = typeof args.query === 'string' ? args.query : '';
      return JSON.stringify(E2E_CONTACTS);
    case 'contacts_get':
    case 'contacts_get_full':
      return JSON.stringify(E2E_CONTACTS.find((contact) => contact.id === args.id) ?? null);
    case 'sms_compose': {
      const rawRecipients = Array.isArray(args.recipients)
        ? args.recipients.filter((recipient): recipient is string => typeof recipient === 'string')
        : [];
      let recipients: string[];
      try {
        recipients = normalizePhoneNumberList(
          rawRecipients,
          'recipients',
          readOptionalStringArg(args, 'defaultCountry'),
        );
      } catch (error) {
        return buildInvalidFixtureArgsError(
          name,
          error instanceof Error ? error.message : 'Invalid SMS recipients.',
          typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : undefined,
        );
      }
      if (recipients.length === 0) {
        return buildInvalidFixtureArgsError(
          name,
          'recipients must contain at least one phone number.',
        );
      }
      e2eNativeFixtureState.sms.opened = true;
      e2eNativeFixtureState.sms.recipientCount = recipients.length;
      e2eNativeFixtureState.sms.messageLength =
        typeof args.message === 'string' ? args.message.length : 0;
      return JSON.stringify({
        status: 'sms_composer_opened',
        recipientCount: e2eNativeFixtureState.sms.recipientCount,
        messageLength: e2eNativeFixtureState.sms.messageLength,
      });
    }
    case 'clipboard_write':
      e2eClipboardText = typeof args.text === 'string' ? args.text : '';
      e2eNativeFixtureState.clipboard.text = e2eClipboardText;
      e2eNativeFixtureState.clipboard.writeCount += 1;
      return JSON.stringify({
        status: 'clipboard_written',
        textLength: e2eClipboardText.length,
      });
    case 'clipboard_read':
      e2eNativeFixtureState.clipboard.readCount += 1;
      return JSON.stringify({
        status: 'clipboard_read',
        text: e2eClipboardText,
        textLength: e2eClipboardText.length,
      });
    case 'clipboard': {
      const action = typeof args.action === 'string' ? args.action.toLowerCase() : '';
      if (action === 'write') {
        e2eClipboardText = typeof args.text === 'string' ? args.text : '';
        e2eNativeFixtureState.clipboard.text = e2eClipboardText;
        e2eNativeFixtureState.clipboard.writeCount += 1;
        return JSON.stringify({
          status: 'clipboard_written',
          textLength: e2eClipboardText.length,
        });
      }
      if (action === 'read') {
        e2eNativeFixtureState.clipboard.readCount += 1;
        return JSON.stringify({
          status: 'clipboard_read',
          text: e2eClipboardText,
          textLength: e2eClipboardText.length,
        });
      }
      return JSON.stringify({ status: 'validation_error', code: 'validation_error' });
    }
    case 'share_text':
      e2eNativeFixtureState.share.opened = true;
      e2eNativeFixtureState.share.kind = 'text';
      e2eNativeFixtureState.share.textLength = typeof args.text === 'string' ? args.text.length : 0;
      return JSON.stringify({
        status: 'share_sheet_opened',
        kind: 'text',
        textLength: e2eNativeFixtureState.share.textLength,
        hasTitle: typeof args.title === 'string' && args.title.length > 0,
      });
    case 'share':
      e2eNativeFixtureState.share.opened = true;
      e2eNativeFixtureState.share.kind = typeof args.kind === 'string' ? args.kind : 'text';
      e2eNativeFixtureState.share.textLength = typeof args.text === 'string' ? args.text.length : 0;
      return JSON.stringify({
        status: 'share_sheet_opened',
        kind: e2eNativeFixtureState.share.kind,
        textLength: e2eNativeFixtureState.share.textLength,
      });
    case 'notification_send':
      e2eNativeFixtureState.notification.displayed = true;
      return JSON.stringify({
        status: 'notification_displayed',
        id: 'e2e-notification-now',
        titleLength: typeof args.title === 'string' ? args.title.length : 0,
        bodyLength: typeof args.body === 'string' ? args.body.length : 0,
      });
    case 'notification_schedule':
      e2eNativeFixtureState.notification.scheduled = true;
      e2eNativeFixtureState.notification.delaySeconds =
        typeof args.delaySeconds === 'number' ? Math.max(0, Math.floor(args.delaySeconds)) : 0;
      return JSON.stringify({
        status: 'notification_scheduled',
        id: 'e2e-notification-scheduled',
        delaySeconds: e2eNativeFixtureState.notification.delaySeconds,
      });
    case 'notification_cancel':
      e2eNativeFixtureState.notification.cancelled = true;
      return JSON.stringify({
        status: 'notification_cancelled',
        id: typeof args.id === 'string' ? args.id : 'e2e-notification-scheduled',
        cancelled: true,
      });
    case 'photos_latest': {
      const photos = [
        {
          id: 'e2e-photo-1',
          uri: 'media-library://e2e/photo-1',
          filename: 'e2e-photo-1.jpg',
          width: 1024,
          height: 768,
          creationTime: 1770681600000,
          mediaType: 'photo',
        },
        {
          id: 'e2e-photo-2',
          uri: 'media-library://e2e/photo-2',
          filename: 'e2e-photo-2.jpg',
          width: 1200,
          height: 900,
          creationTime: 1770681660000,
          mediaType: 'photo',
        },
      ].slice(0, typeof args.count === 'number' ? Math.max(0, Math.min(args.count, 20)) : 2);
      e2eNativeFixtureState.media.photoCount = photos.length;
      return JSON.stringify(photos);
    }
    case 'screen_record':
      e2eNativeFixtureState.media.screenStatus = 'captured';
      e2eNativeFixtureState.media.screenBase64Length = 2048;
      return JSON.stringify({
        status: 'captured',
        format: args.format === 'jpeg' ? 'jpeg' : 'png',
        base64Length: 2048,
        data: 'E2E_SCREEN_BASE64...(truncated)',
      });
    case 'camera_clip':
      e2eNativeFixtureState.media.cameraStatus = 'recorded';
      e2eNativeFixtureState.media.cameraDuration =
        typeof args.durationSeconds === 'number' ? args.durationSeconds : 10;
      return JSON.stringify({
        status: 'recorded',
        uri: 'file:///e2e/camera-clip.mp4',
        width: 1280,
        height: 720,
        duration: e2eNativeFixtureState.media.cameraDuration,
        mimeType: 'video/mp4',
      });
    default:
      return null;
  }
}
