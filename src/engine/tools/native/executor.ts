import {
  executeCalendarCreate,
  executeCalendarEvents,
  executeCalendarList,
  executeCalendarUpdate,
} from './calendar/executor';
import { executeClipboardRead, executeClipboardWrite } from './clipboard/executor';
import {
  executeContactsCreate,
  executeContactsEdit,
  executeContactsGet,
  executeContactsGetFull,
  executeContactsManageAccess,
  executeContactsPick,
  executeContactsSearch,
  executeContactsSearchFull,
  executeContactsShare,
  executeContactsView,
} from './contacts/executor';
import {
  executeEmailCompose,
  executeMapsOpen,
  executeOpenUrl,
  executePhoneCall,
  executeSmsCompose,
} from './communication/executor';
import {
  executeDeviceHealth,
  executeDeviceInfo,
  executeDevicePermissions,
  executeDeviceStatus,
} from './device/executor';
import { executeHapticFeedback } from './haptics/executor';
import { executeLocationCurrent } from './location/executor';
import { executeCameraClip, executePhotosLatest, executeScreenRecord } from './media/executor';
import {
  executeNotificationCancel,
  executeNotificationSchedule,
  executeNotificationSend,
} from './notifications/executor';
import {
  executeShare,
  executeShareContact,
  executeShareFile,
  executeShareText,
  executeShareUrl,
} from './share/executor';

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
    case 'calendar_update_event':
      return executeCalendarUpdate(args);
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
    case 'contacts_form': {
      const action = typeof args?.action === 'string' ? args.action.toLowerCase() : '';
      if (action === 'view') return executeContactsView(args);
      if (action === 'edit') return executeContactsEdit(args);
      if (action === 'create') return executeContactsCreate(args);
      return 'Error: contacts_form requires action ∈ {view, edit, create}';
    }
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
    case 'clipboard': {
      const action = typeof args?.action === 'string' ? args.action.toLowerCase() : '';
      if (action === 'read') return executeClipboardRead();
      if (action === 'write') return executeClipboardWrite(args);
      return 'Error: clipboard requires action ∈ {read, write}';
    }
    case 'share_text':
      return executeShareText(args);
    case 'share_url':
      return executeShareUrl(args);
    case 'share_file':
      return executeShareFile(args);
    case 'share_contact':
      return executeShareContact(args);
    case 'share': {
      const kind = typeof args?.kind === 'string' ? args.kind.toLowerCase() : '';
      if (kind === 'text') return executeShareText(args);
      if (kind === 'url') return executeShareUrl(args);
      if (kind === 'file') return executeShareFile(args);
      if (kind === 'contact') return executeShareContact(args);
      // Legacy back-compat: bare share() with no kind delegates to existing executor.
      return executeShare(args);
    }
    case 'open_url':
      return executeOpenUrl(args);
    case 'notification_send':
      return executeNotificationSend(args);
    case 'notification_schedule':
      return executeNotificationSchedule(args);
    case 'notification_cancel':
      return executeNotificationCancel(args);
    case 'device_status':
      return executeDeviceStatus();
    case 'device_info':
      return executeDeviceInfo();
    case 'device_permissions':
      return executeDevicePermissions();
    case 'device_health':
      return executeDeviceHealth();
    case 'device_query': {
      const kind = typeof args?.kind === 'string' ? args.kind.toLowerCase() : '';
      if (kind === 'status') return executeDeviceStatus();
      if (kind === 'info') return executeDeviceInfo();
      if (kind === 'permissions') return executeDevicePermissions();
      if (kind === 'health') return executeDeviceHealth();
      return 'Error: device_query requires kind ∈ {status, info, permissions, health}';
    }
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
