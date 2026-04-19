// ---------------------------------------------------------------------------
// Kavi — Native Device Tool Executors
// ---------------------------------------------------------------------------
// Implements native tool execution using Expo libraries.
// Each tool gracefully handles missing permissions.

import * as Clipboard from 'expo-clipboard';
import { Linking } from 'react-native';
import { sendLocalNotification } from '../../services/notifications/service';
import {
  executeNativeAction,
  serializeNativeActionResult,
} from '../../services/nativeActions/actionService';

// ── Calendar Tools ───────────────────────────────────────────────────────

async function loadCalendarModule() {
  try {
    return await import('expo-calendar');
  } catch {
    return null;
  }
}

export async function executeCalendarList(): Promise<string> {
  const Calendar = await loadCalendarModule();
  if (!Calendar) return JSON.stringify({ error: 'Calendar module not available' });

  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return JSON.stringify({ error: 'Calendar permission denied' });

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return JSON.stringify(
    calendars.map((c: any) => ({
      id: c.id,
      title: c.title,
      source: c.source?.name,
      color: c.color,
      allowsModifications: c.allowsModifications,
    })),
  );
}

export async function executeCalendarEvents(args: {
  startDate: string;
  endDate: string;
  calendarId?: string;
}): Promise<string> {
  const Calendar = await loadCalendarModule();
  if (!Calendar) return JSON.stringify({ error: 'Calendar module not available' });

  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return JSON.stringify({ error: 'Calendar permission denied' });

  const start = new Date(args.startDate);
  const end = new Date(args.endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return JSON.stringify({ error: 'Invalid date format. Use ISO 8601.' });
  }

  const calendarIds = args.calendarId ? [args.calendarId] : undefined;
  const events = await Calendar.getEventsAsync(calendarIds as any, start, end);

  return JSON.stringify(
    events.slice(0, 50).map((e: any) => ({
      id: e.id,
      title: e.title,
      startDate: e.startDate,
      endDate: e.endDate,
      location: e.location,
      notes: e.notes?.slice(0, 200),
      allDay: e.allDay,
    })),
  );
}

export async function executeCalendarCreate(args: {
  title: string;
  startDate: string;
  endDate: string;
  location?: string;
  notes?: string;
  calendarId?: string;
  allDay?: boolean;
}): Promise<string> {
  const Calendar = await loadCalendarModule();
  if (!Calendar) return JSON.stringify({ error: 'Calendar module not available' });

  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return JSON.stringify({ error: 'Calendar permission denied' });

  const start = new Date(args.startDate);
  const end = new Date(args.endDate);

  if (isNaN(start.getTime())) {
    return JSON.stringify({
      error: `Invalid start date: "${args.startDate}". Use ISO 8601 format (e.g. 2025-03-20T10:00:00).`,
    });
  }
  if (isNaN(end.getTime())) {
    return JSON.stringify({
      error: `Invalid end date: "${args.endDate}". Use ISO 8601 format (e.g. 2025-03-20T11:00:00).`,
    });
  }

  // Ensure end is after start; if equal, add 1 hour
  if (end.getTime() <= start.getTime()) {
    end.setTime(start.getTime() + 60 * 60 * 1000);
  }

  let calendarId = args.calendarId;
  if (!calendarId) {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    // Prefer the default calendar, then any writable one
    const defaultCal = calendars.find((c: any) => c.isPrimary && c.allowsModifications);
    const writable = defaultCal || calendars.find((c: any) => c.allowsModifications);
    if (!writable)
      return JSON.stringify({
        error: 'No writable calendar found on this device. Please create a calendar first.',
      });
    calendarId = writable.id;
  }

  const isAllDay =
    args.allDay ??
    (start.getHours() === 0 &&
      start.getMinutes() === 0 &&
      end.getHours() === 0 &&
      end.getMinutes() === 0);

  try {
    const eventDetails: Record<string, any> = {
      title: args.title,
      startDate: start,
      endDate: end,
      location: args.location,
      notes: args.notes,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      allDay: isAllDay,
    };

    const eventId = await Calendar.createEventAsync(calendarId, eventDetails);
    return JSON.stringify({ status: 'created', eventId, calendarId });
  } catch (err: unknown) {
    // Provide actionable error messages
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('could not be saved') || msg.includes('saveEventAsync')) {
      return JSON.stringify({
        error: `Calendar event could not be saved. This usually means the calendar doesn't accept events at this time. Try: (1) Use a different calendarId (call calendar_list first), (2) Check the date format is ISO 8601, (3) Ensure end date is after start date.`,
        details: msg,
      });
    }
    return JSON.stringify({ error: `Failed to create event: ${msg}` });
  }
}

// ── Contacts Tools ───────────────────────────────────────────────────────

async function executeStructuredNativeAction(
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const result = await executeNativeAction(name, args);
  return serializeNativeActionResult(result);
}

export async function executeContactsSearch(args: {
  query: string;
  limit?: number;
}): Promise<string> {
  return executeStructuredNativeAction('contacts_search', args as Record<string, unknown>);
}

export async function executeContactsGet(args: { id: string }): Promise<string> {
  return executeStructuredNativeAction('contacts_get', args as Record<string, unknown>);
}

export async function executeContactsPick(): Promise<string> {
  return executeStructuredNativeAction('contacts_pick');
}

export async function executeContactsManageAccess(): Promise<string> {
  return executeStructuredNativeAction('contacts_manage_access');
}

export async function executeContactsView(args: { id: string }): Promise<string> {
  return executeStructuredNativeAction('contacts_view', args as Record<string, unknown>);
}

export async function executeContactsEdit(args: Record<string, unknown>): Promise<string> {
  return executeStructuredNativeAction('contacts_edit', args);
}

export async function executeContactsCreate(args: Record<string, unknown>): Promise<string> {
  return executeStructuredNativeAction('contacts_create', args);
}

export async function executeContactsShare(args: {
  id: string;
  message?: string;
}): Promise<string> {
  return executeStructuredNativeAction('contacts_share', args as Record<string, unknown>);
}

export async function executeContactsSearchFull(args: {
  query: string;
  limit?: number;
}): Promise<string> {
  return executeStructuredNativeAction('contacts_search_full', args as Record<string, unknown>);
}

export async function executeContactsGetFull(args: { id: string }): Promise<string> {
  return executeStructuredNativeAction('contacts_get_full', args as Record<string, unknown>);
}

// ── Location Tools ───────────────────────────────────────────────────────

async function loadLocationModule() {
  try {
    return await import('expo-location');
  } catch {
    return null;
  }
}

export async function executeLocationCurrent(): Promise<string> {
  const Location = await loadLocationModule();
  if (!Location) return JSON.stringify({ error: 'Location module not available' });

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return JSON.stringify({ error: 'Location permission denied' });

  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

  // Try reverse geocode
  let address: any = null;
  try {
    const [geo] = await Location.reverseGeocodeAsync({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    });
    if (geo) {
      address = {
        street: geo.street,
        city: geo.city,
        region: geo.region,
        postalCode: geo.postalCode,
        country: geo.country,
      };
    }
  } catch {
    // Reverse geocode not critical
  }

  return JSON.stringify({
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    altitude: location.coords.altitude,
    accuracy: location.coords.accuracy,
    timestamp: location.timestamp,
    address,
  });
}

// ── Clipboard Tools ──────────────────────────────────────────────────────

export async function executeClipboardRead(): Promise<string> {
  const text = await Clipboard.getStringAsync();
  return text || '(clipboard is empty)';
}

export async function executeClipboardWrite(args: { text: string }): Promise<string> {
  await Clipboard.setStringAsync(args.text);
  return `Copied ${args.text.length} characters to clipboard`;
}

// ── Share Tool ───────────────────────────────────────────────────────────

export async function executeShare(args: { text?: string; url?: string }): Promise<string> {
  return executeStructuredNativeAction('share', args as Record<string, unknown>);
}

export async function executeShareText(args: { text: string; title?: string }): Promise<string> {
  return executeStructuredNativeAction('share_text', args as Record<string, unknown>);
}

export async function executeShareUrl(args: {
  url: string;
  message?: string;
  title?: string;
}): Promise<string> {
  return executeStructuredNativeAction('share_url', args as Record<string, unknown>);
}

export async function executeShareFile(args: {
  fileUri: string;
  mimeType?: string;
  dialogTitle?: string;
  uti?: string;
}): Promise<string> {
  return executeStructuredNativeAction('share_file', args as Record<string, unknown>);
}

export async function executeShareContact(args: { id: string; message?: string }): Promise<string> {
  return executeStructuredNativeAction('share_contact', args as Record<string, unknown>);
}

// ── Open URL Tool ────────────────────────────────────────────────────────

export async function executeOpenUrl(args: { url: string }): Promise<string> {
  return executeStructuredNativeAction('open_url', args as Record<string, unknown>);
}

export async function executeEmailCompose(args: Record<string, unknown>): Promise<string> {
  return executeStructuredNativeAction('email_compose', args);
}

export async function executeSmsCompose(args: Record<string, unknown>): Promise<string> {
  return executeStructuredNativeAction('sms_compose', args);
}

export async function executePhoneCall(args: {
  number: string;
  defaultCountry?: string;
}): Promise<string> {
  return executeStructuredNativeAction('phone_call', args as Record<string, unknown>);
}

export async function executeMapsOpen(args: Record<string, unknown>): Promise<string> {
  return executeStructuredNativeAction('maps_open', args);
}

export async function executeNotificationSend(args: {
  title: string;
  body: string;
}): Promise<string> {
  const result = await sendLocalNotification({
    title: args.title,
    body: args.body,
  });
  return JSON.stringify({
    status: 'notification_displayed',
    id: result.id,
    title: args.title,
    body: args.body,
  });
}

export async function executeNotificationSchedule(args: {
  title: string;
  body: string;
  delaySeconds: number;
}): Promise<string> {
  const result = await sendLocalNotification({
    title: args.title,
    body: args.body,
    delaySeconds: args.delaySeconds,
  });
  return JSON.stringify({
    status: 'notification_scheduled',
    id: result.id,
    title: args.title,
    body: args.body,
    delaySeconds: Math.max(0, Math.floor(args.delaySeconds || 0)),
  });
}

// ── Device Status Tool ───────────────────────────────────────────────────

export async function executeDeviceStatus(): Promise<string> {
  try {
    const Battery = await import('expo-battery');
    const Network = await import('expo-network');
    const { Dimensions } = await import('react-native');

    const [batteryLevel, batteryState, networkState] = await Promise.all([
      Battery.getBatteryLevelAsync().catch(() => -1),
      Battery.getBatteryStateAsync().catch(() => 0),
      Network.getNetworkStateAsync().catch(() => ({})),
    ]);

    const screen = Dimensions.get('window');
    const batteryStateNames: Record<number, string> = {
      0: 'unknown',
      1: 'unplugged',
      2: 'charging',
      3: 'full',
    };

    return JSON.stringify({
      battery: {
        level: Math.round((batteryLevel as number) * 100),
        state: batteryStateNames[batteryState as number] || 'unknown',
      },
      network: {
        isConnected: (networkState as any).isConnected,
        type: (networkState as any).type,
        isInternetReachable: (networkState as any).isInternetReachable,
      },
      screen: { width: screen.width, height: screen.height },
    });
  } catch (err: unknown) {
    return JSON.stringify({
      error: `Device status failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ── Device Info Tool ─────────────────────────────────────────────────────

export async function executeDeviceInfo(): Promise<string> {
  try {
    const Device = await import('expo-device');
    const { Platform } = await import('react-native');

    return JSON.stringify({
      brand: Device.brand,
      modelName: Device.modelName,
      designName: Device.designName,
      osName: Device.osName,
      osVersion: Device.osVersion,
      platformApiLevel: Device.platformApiLevel,
      totalMemory: Device.totalMemory,
      deviceType: Device.deviceType,
      isDevice: Device.isDevice,
      platform: Platform.OS,
    });
  } catch (err: unknown) {
    return JSON.stringify({
      error: `Device info failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ── Device Permissions Tool ──────────────────────────────────────────────

export async function executeDevicePermissions(): Promise<string> {
  const permissions: Record<string, string> = {};

  try {
    const Calendar = await import('expo-calendar');
    const calPerm = await Calendar.getCalendarPermissionsAsync();
    permissions.calendar = calPerm.status;
  } catch {
    permissions.calendar = 'unavailable';
  }

  try {
    const Contacts = await import('expo-contacts');
    const contactPerm = await Contacts.getPermissionsAsync();
    permissions.contacts = contactPerm.status;
  } catch {
    permissions.contacts = 'unavailable';
  }

  try {
    const Location = await import('expo-location');
    const locPerm = await Location.getForegroundPermissionsAsync();
    permissions.location = locPerm.status;
  } catch {
    permissions.location = 'unavailable';
  }

  try {
    const ImagePicker = await import('expo-image-picker');
    const cameraPerm = await ImagePicker.getCameraPermissionsAsync();
    permissions.camera = cameraPerm.status;
    const mediaPerm = await ImagePicker.getMediaLibraryPermissionsAsync();
    permissions.mediaLibrary = mediaPerm.status;
  } catch {
    permissions.camera = 'unavailable';
    permissions.mediaLibrary = 'unavailable';
  }

  try {
    const { getRecordingPermissionsAsync } = await import('expo-audio');
    const audioPerm = await getRecordingPermissionsAsync();
    permissions.microphone = audioPerm.status;
  } catch {
    permissions.microphone = 'unavailable';
  }

  return JSON.stringify(permissions);
}

// ── Device Health Tool ───────────────────────────────────────────────────

export async function executeDeviceHealth(): Promise<string> {
  try {
    const Device = await import('expo-device');
    const Battery = await import('expo-battery');
    const { Paths } = await import('expo-file-system');

    const batteryLevel = await Battery.getBatteryLevelAsync().catch(() => -1);
    const uptime = Device.getUptimeAsync ? await Device.getUptimeAsync().catch(() => -1) : -1;

    return JSON.stringify({
      totalMemory: Device.totalMemory,
      batteryLevel: Math.round((batteryLevel as number) * 100),
      isDevice: Device.isDevice,
      supportedCpuArchitectures: Device.supportedCpuArchitectures,
      uptime,
      documentsDir: Paths.document?.uri,
    });
  } catch (err: unknown) {
    return JSON.stringify({
      error: `Device health check failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ── Photos Latest Tool ───────────────────────────────────────────────────

export async function executePhotosLatest(args: { count?: number }): Promise<string> {
  try {
    const MediaLibrary = await import('expo-media-library');
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') return JSON.stringify({ error: 'Media library permission denied' });

    const count = Math.min(args.count || 5, 20);
    const assets = await MediaLibrary.getAssetsAsync({
      first: count,
      sortBy: [MediaLibrary.SortBy.creationTime],
      mediaType: [MediaLibrary.MediaType.photo],
    });

    return JSON.stringify(
      assets.assets.map((a: any) => ({
        id: a.id,
        uri: a.uri,
        filename: a.filename,
        width: a.width,
        height: a.height,
        creationTime: a.creationTime,
        mediaType: a.mediaType,
      })),
    );
  } catch (err: unknown) {
    return JSON.stringify({
      error: `Photos access failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ── Camera Clip Tool ─────────────────────────────────────────────────────

export async function executeCameraClip(args: {
  durationSeconds?: number;
  quality?: string;
  camera?: string;
}): Promise<string> {
  try {
    const ImagePicker = await import('expo-image-picker');
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: args.durationSeconds || 10,
      quality: args.quality === 'high' ? 1 : args.quality === 'low' ? 0.3 : 0.5,
      cameraType:
        args.camera === 'front' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
    });

    if (result.canceled || !result.assets?.[0]) {
      return JSON.stringify({ status: 'cancelled' });
    }

    const asset = result.assets[0];
    return JSON.stringify({
      status: 'recorded',
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      mimeType: asset.mimeType || 'video/mp4',
    });
  } catch (err: unknown) {
    return JSON.stringify({
      error: `Camera clip failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ── Screen Record (Screenshot) Tool ──────────────────────────────────────

export async function executeScreenRecord(args: { format?: string }): Promise<string> {
  try {
    const { captureScreen } = await import('react-native-view-shot');
    const uri = await captureScreen({
      format: args.format === 'jpeg' ? 'jpg' : 'png',
      quality: 0.9,
      result: 'base64',
    });
    return JSON.stringify({
      status: 'captured',
      format: args.format || 'png',
      base64Length: uri.length,
      data: uri.slice(0, 1000) + (uri.length > 1000 ? '...(truncated)' : ''),
    });
  } catch {
    // Fallback: return a message about needing react-native-view-shot
    return JSON.stringify({
      status: 'screenshot_not_available',
      message: 'Screen capture requires react-native-view-shot. Install it for this feature.',
    });
  }
}

// ── Haptic Feedback Tool ─────────────────────────────────────────────────

export async function executeHapticFeedback(args: { type?: string }): Promise<string> {
  try {
    const Haptics = await import('expo-haptics');
    const type = args.type || 'medium';

    switch (type) {
      case 'light':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'heavy':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'success':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'error':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
      case 'medium':
      default:
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
    }

    return JSON.stringify({ status: 'triggered', type });
  } catch (err: unknown) {
    return JSON.stringify({
      error: `Haptic feedback failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ── Dispatcher ───────────────────────────────────────────────────────────

export async function executeNativeTool(name: string, argsString: string): Promise<string> {
  let args: any;
  try {
    args = JSON.parse(argsString);
  } catch {
    return 'Error: invalid tool arguments JSON';
  }

  switch (name) {
    case 'calendar_list':
      return executeCalendarList();
    case 'calendar_events':
      return executeCalendarEvents(args);
    case 'calendar_create_event':
      return executeCalendarCreate(args);
    case 'email_compose':
      return executeEmailCompose(args);
    case 'sms_compose':
      return executeSmsCompose(args);
    case 'phone_call':
      return executePhoneCall(args);
    case 'maps_open':
      return executeMapsOpen(args);
    case 'contacts_pick':
      return executeContactsPick();
    case 'contacts_manage_access':
      return executeContactsManageAccess();
    case 'contacts_view':
      return executeContactsView(args);
    case 'contacts_edit':
      return executeContactsEdit(args);
    case 'contacts_create':
      return executeContactsCreate(args);
    case 'contacts_share':
      return executeContactsShare(args);
    case 'contacts_search_full':
      return executeContactsSearchFull(args);
    case 'contacts_get_full':
      return executeContactsGetFull(args);
    case 'contacts_search':
      return executeContactsSearch(args);
    case 'contacts_get':
      return executeContactsGet(args);
    case 'location_current':
      return executeLocationCurrent();
    case 'clipboard_read':
      return executeClipboardRead();
    case 'clipboard_write':
      return executeClipboardWrite(args);
    case 'share_text':
      return executeShareText(args);
    case 'share_url':
      return executeShareUrl(args);
    case 'share_file':
      return executeShareFile(args);
    case 'share_contact':
      return executeShareContact(args);
    case 'share':
      return executeShare(args);
    case 'open_url':
      return executeOpenUrl(args);
    case 'notification_send':
      return executeNotificationSend(args);
    case 'notification_schedule':
      return executeNotificationSchedule(args);
    case 'device_status':
      return executeDeviceStatus();
    case 'device_info':
      return executeDeviceInfo();
    case 'device_permissions':
      return executeDevicePermissions();
    case 'device_health':
      return executeDeviceHealth();
    case 'photos_latest':
      return executePhotosLatest(args);
    case 'camera_clip':
      return executeCameraClip(args);
    case 'screen_record':
      return executeScreenRecord(args);
    case 'haptic_feedback':
      return executeHapticFeedback(args);
    default:
      return `Error: unknown native tool "${name}"`;
  }
}
