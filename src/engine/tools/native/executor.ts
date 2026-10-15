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
  executeContactsManageAccess,
  executeContactsPick,
  executeContactsSearch,
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
import { executeLocationCurrent } from './location/executor';
import { executeCameraClip, executePhotosPick, executeScreenRecord } from './media/executor';
import {
  executeNotificationSend,
  executeNotificationsRead,
  executeNotificationsReply,
} from './notifications/executor';
import { executeShareFile, executeShareText } from './share/executor';
import { failedToolOutcome, type ToolRuntimeOutcome } from '../../../types/toolRuntimeOutcome';

export async function executeNativeTool(
  name: string,
  argsString: string,
  executionSignal?: AbortSignal,
): Promise<ToolRuntimeOutcome> {
  if (executionSignal?.aborted) {
    return failedToolOutcome('Error: Request cancelled', 'aborted');
  }
  let args: any;
  try {
    args = JSON.parse(argsString);
  } catch {
    return failedToolOutcome('Error: invalid tool arguments JSON', 'invalid_arguments');
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
    case 'contacts_form': {
      const action = typeof args?.action === 'string' ? args.action.toLowerCase() : '';
      if (action === 'view') return executeContactsView(args);
      if (action === 'edit') return executeContactsEdit(args);
      if (action === 'create') return executeContactsCreate(args);
      return failedToolOutcome(
        'Error: contacts_form requires action ∈ {view, edit, create}',
        'invalid_arguments',
      );
    }
    case 'contacts_share':
      return executeContactsShare(args);
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
    case 'share_file':
      return executeShareFile(args);
    case 'open_url':
      return executeOpenUrl(args);
    case 'notification_send':
      return executeNotificationSend(args);
    case 'notifications_read':
      return executeNotificationsRead(args);
    case 'notifications_reply':
      return executeNotificationsReply(args);
    case 'device_query': {
      const kind = typeof args?.kind === 'string' ? args.kind.toLowerCase() : 'status';
      if (kind === 'status') return executeDeviceStatus();
      if (kind === 'info') return executeDeviceInfo();
      if (kind === 'permissions') return executeDevicePermissions();
      if (kind === 'health') return executeDeviceHealth();
      return failedToolOutcome(
        'Error: device_query kind must be one of {status, info, permissions, health}',
        'invalid_arguments',
      );
    }
    case 'photos_pick':
      return executePhotosPick(args);
    case 'camera_clip':
      return executeCameraClip(args);
    case 'screen_record':
      return executeScreenRecord(args);
    default:
      return failedToolOutcome(`Error: unknown native tool "${name}"`, 'not_found');
  }
}
