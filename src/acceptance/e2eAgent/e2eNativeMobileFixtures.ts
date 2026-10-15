// Node live E2E lacks Expo native modules. The acceptance environment installs
// this fixture at the generic native-tool boundary for the duration of a run.

import { ALL_NATIVE_TOOL_DEFINITIONS } from '../../engine/tools/native/definitions';
import {
  recordE2ENativeMobileInvocation,
  resetE2ENativeMobileInvocationEvidence,
} from './e2eNativeMobileEvidence';
import {
  E2E_FIXTURE_DEVICE_HEALTH_JSON,
  E2E_FIXTURE_DEVICE_INFO_JSON,
  E2E_FIXTURE_DEVICE_PERMISSIONS_JSON,
  E2E_FIXTURE_DEVICE_STATUS_JSON,
  E2E_NATIVE_PERMISSION_STATES,
} from './e2eNativeDeviceFixtures';
import {
  completedE2ENativeOutcome,
  failedE2ENativeOutcome,
  type E2ENativeMobileOutcome,
} from './e2eNativeMobileOutcome';
import {
  createEmptyE2ECalendarState,
  executeE2ECalendarFixtureTool,
  resetE2ECalendarEvents,
  seedE2ECalendarEvents,
  type E2ECalendarEvent,
  type E2ECalendarFixtureState,
} from './e2eNativeCalendarFixtures';
import {
  buildE2ESmsDraft,
  getE2EContact,
  resetE2EContacts,
  searchE2EContacts,
  seedE2EContacts,
  type E2EFixtureContact,
} from './e2eNativeMessagingFixtures';

export {
  E2E_FIXTURE_DEVICE_HEALTH_JSON,
  E2E_FIXTURE_DEVICE_INFO_JSON,
  E2E_FIXTURE_DEVICE_PERMISSIONS_JSON,
  E2E_FIXTURE_DEVICE_STATUS_JSON,
  E2E_NATIVE_PERMISSION_STATES,
} from './e2eNativeDeviceFixtures';

export { getE2ENativeMobileInvocationSnapshots } from './e2eNativeMobileEvidence';
export type { E2ENativeMobileInvocationSnapshot } from './e2eNativeMobileEvidence';
export {
  E2E_FIXTURE_CALENDAR_EVENTS_JSON,
  E2E_FIXTURE_CALENDAR_LIST_JSON,
} from './e2eNativeCalendarFixtures';

function applyE2EPermissionFixtureState(): void {
  e2eNativeFixtureState.permissions.location = E2E_NATIVE_PERMISSION_STATES.denied.location.status;
  e2eNativeFixtureState.permissions.mediaLibrary =
    E2E_NATIVE_PERMISSION_STATES.revokedMidTask.mediaLibrary.status;
  e2eNativeFixtureState.permissions.screenCapture =
    E2E_NATIVE_PERMISSION_STATES.unavailable.screenCapture.status;
}

/** What a scenario's phone holds before the first turn, instead of the default device. */
export type E2ENativeFixtureSeed = Readonly<{
  contacts?: ReadonlyArray<E2EFixtureContact>;
  calendarEvents?: ReadonlyArray<E2ECalendarEvent>;
}>;

export type E2ENativeMobileFixtureStateSnapshot = {
  calendar: E2ECalendarFixtureState;
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
    /** The draft's E.164 recipients, comma-separated. */
    recipients: string;
    message: string;
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
    calendar: createEmptyE2ECalendarState(),
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
      recipients: '',
      message: '',
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

// Argument rejections carry the status the native action service gives them
// (NativeActionError's 'invalid_request'): a rejection the effect contract does not map reads
// as an unknown effect, which ends the run as "may have changed external state" instead of
// letting the model correct its call, as the app does.
function buildMissingRequiredArgsError(name: string, missing: string[]): E2ENativeMobileOutcome {
  return failedE2ENativeOutcome({
    status: 'invalid_request',
    code: 'missing_required_argument',
    tool: name,
    missingRequiredArguments: missing,
    error: `Missing required argument${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
  });
}

function buildInvalidFixtureArgsError(
  name: string,
  message: string,
  code = 'invalid_arguments',
): E2ENativeMobileOutcome {
  return failedE2ENativeOutcome({
    status: 'invalid_request',
    code,
    tool: name,
    error: message,
  });
}

function validateE2ENativeRequiredArgs(
  name: string,
  args: Record<string, unknown>,
): E2ENativeMobileOutcome | null {
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
  resetE2ECalendarEvents();
  e2eNativeFixtureState = createEmptyNativeFixtureState();
  resetE2EContacts();
  resetE2ENativeMobileInvocationEvidence();
}

/** Gives the phone the scenario's own contacts and calendar, after a reset. */
export function seedE2ENativeMobileFixtures(seed: E2ENativeFixtureSeed): void {
  if (seed.contacts) seedE2EContacts(seed.contacts);
  if (seed.calendarEvents) seedE2ECalendarEvents(seed.calendarEvents);
}

/** The operating system accepted a notification that fires `delaySeconds` from now. */
export function recordE2ENotificationScheduled(delaySeconds: number): void {
  e2eNativeFixtureState.notification.scheduled = true;
  e2eNativeFixtureState.notification.delaySeconds = delaySeconds;
}

/** The operating system withdrew a notification it had scheduled. */
export function recordE2ENotificationCancelled(): void {
  e2eNativeFixtureState.notification.cancelled = true;
}

export function getE2ENativeMobileFixtureStateSnapshot(): E2ENativeMobileFixtureStateSnapshot {
  return JSON.parse(JSON.stringify(e2eNativeFixtureState)) as E2ENativeMobileFixtureStateSnapshot;
}

export async function tryExecuteE2ENativeCalendarTool(
  name: string,
  argsString: string,
): Promise<E2ENativeMobileOutcome | null> {
  const args = parseFixtureArgs(argsString);
  const validationError = validateE2ENativeRequiredArgs(name, args);
  if (validationError) {
    return validationError;
  }

  return executeE2ECalendarFixtureTool(name, args, e2eNativeFixtureState.calendar);
}

async function executeE2ENativeMobileTool(
  name: string,
  argsString: string,
): Promise<E2ENativeMobileOutcome | null> {
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
    case 'maps_open': {
      const targetKind =
        typeof args.latitude === 'number' && typeof args.longitude === 'number'
          ? 'coordinates'
          : 'query';
      e2eNativeFixtureState.maps.opened = true;
      e2eNativeFixtureState.maps.targetKind = targetKind;
      // The shape the native action service returns: status `opened`, code `maps_opened`.
      return completedE2ENativeOutcome({
        status: 'opened',
        code: 'maps_opened',
        details: { targetKind },
      });
    }
    case 'device_query': {
      const kind = typeof args.kind === 'string' ? args.kind.toLowerCase() : 'status';
      if (kind === 'status') return completedE2ENativeOutcome(E2E_FIXTURE_DEVICE_STATUS_JSON);
      if (kind === 'info') return completedE2ENativeOutcome(E2E_FIXTURE_DEVICE_INFO_JSON);
      if (kind === 'health') return completedE2ENativeOutcome(E2E_FIXTURE_DEVICE_HEALTH_JSON);
      if (kind === 'permissions') {
        applyE2EPermissionFixtureState();
        return completedE2ENativeOutcome(E2E_FIXTURE_DEVICE_PERMISSIONS_JSON);
      }
      return null;
    }
    case 'location_current':
      return failedE2ENativeOutcome({
        status: 'permission_denied',
        code: 'permission_denied',
        permission: E2E_NATIVE_PERMISSION_STATES.denied.location,
      });
    case 'contacts_search': {
      const query = typeof args.query === 'string' ? args.query : '';
      const results = searchE2EContacts(query);
      e2eNativeFixtureState.contacts.resultCount = results.length;
      e2eNativeFixtureState.contacts.lastQuery = query;
      return completedE2ENativeOutcome(results);
    }
    case 'contacts_get':
      return completedE2ENativeOutcome(getE2EContact(args.id));
    case 'sms_compose': {
      const built = buildE2ESmsDraft(args);
      if ('error' in built) {
        return buildInvalidFixtureArgsError(name, built.error, built.code);
      }
      const { recipients, message } = built.draft;
      e2eNativeFixtureState.sms.opened = true;
      e2eNativeFixtureState.sms.recipientCount = recipients.length;
      e2eNativeFixtureState.sms.messageLength = message.length;
      e2eNativeFixtureState.sms.recipients = recipients.join(',');
      e2eNativeFixtureState.sms.message = message;
      return completedE2ENativeOutcome({
        status: 'sms_composer_opened',
        recipientCount: e2eNativeFixtureState.sms.recipientCount,
        messageLength: e2eNativeFixtureState.sms.messageLength,
      });
    }
    case 'clipboard_write':
      e2eClipboardText = typeof args.text === 'string' ? args.text : '';
      e2eNativeFixtureState.clipboard.text = e2eClipboardText;
      e2eNativeFixtureState.clipboard.writeCount += 1;
      return completedE2ENativeOutcome({
        status: 'written_verified',
        characterCount: e2eClipboardText.length,
        verified: true,
      });
    case 'clipboard_read':
      e2eNativeFixtureState.clipboard.readCount += 1;
      return completedE2ENativeOutcome({
        status: 'read',
        text: e2eClipboardText,
        empty: e2eClipboardText.length === 0,
      });
    case 'share_text':
      e2eNativeFixtureState.share.opened = true;
      e2eNativeFixtureState.share.kind = 'text';
      e2eNativeFixtureState.share.textLength = typeof args.text === 'string' ? args.text.length : 0;
      return completedE2ENativeOutcome({
        status: 'handed_off',
        summary: 'Opened the native share sheet for text.',
        details: { activityType: null },
        code: 'share_handed_off',
      });
    case 'notification_send':
      e2eNativeFixtureState.notification.displayed = true;
      return completedE2ENativeOutcome({
        status: 'notification_accepted',
        id: 'e2e-notification-now',
        titleLength: typeof args.title === 'string' ? args.title.length : 0,
        bodyLength: typeof args.body === 'string' ? args.body.length : 0,
      });
    case 'photos_pick': {
      const requestedCount =
        typeof args.count === 'number' && Number.isFinite(args.count) ? Math.floor(args.count) : 1;
      const photos = [
        {
          assetId: 'e2e-photo-1',
          uri: 'file:///e2e/photo-1.jpg',
          fileName: 'e2e-photo-1.jpg',
          fileSize: 2048,
          width: 1024,
          height: 768,
          mimeType: 'image/jpeg',
        },
        {
          assetId: 'e2e-photo-2',
          uri: 'file:///e2e/photo-2.jpg',
          fileName: 'e2e-photo-2.jpg',
          fileSize: 3072,
          width: 1200,
          height: 900,
          mimeType: 'image/jpeg',
        },
      ].slice(0, Math.min(Math.max(requestedCount, 1), 20));
      e2eNativeFixtureState.media.photoCount = photos.length;
      return completedE2ENativeOutcome({ status: 'selected', assets: photos });
    }
    case 'screen_record':
      e2eNativeFixtureState.media.screenStatus = 'captured';
      e2eNativeFixtureState.media.screenBase64Length = 2048;
      return completedE2ENativeOutcome({
        status: 'captured',
        format: args.format === 'jpeg' ? 'jpeg' : 'png',
        base64Length: 2048,
        data: 'E2E_SCREEN_BASE64...(truncated)',
      });
    case 'camera_clip':
      e2eNativeFixtureState.media.cameraStatus = 'recorded';
      e2eNativeFixtureState.media.cameraDuration =
        typeof args.durationSeconds === 'number' ? args.durationSeconds : 10;
      return completedE2ENativeOutcome({
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

export async function tryExecuteE2ENativeMobileTool(
  name: string,
  argsString: string,
): Promise<E2ENativeMobileOutcome | null> {
  const stateBefore = getE2ENativeMobileFixtureStateSnapshot();
  const result = await executeE2ENativeMobileTool(name, argsString);
  const stateAfter = getE2ENativeMobileFixtureStateSnapshot();
  recordE2ENativeMobileInvocation({
    toolName: name,
    result,
    stateBefore,
    stateAfter,
  });
  return result;
}
