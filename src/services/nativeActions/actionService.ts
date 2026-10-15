import { buildMapsUrl, summarizeMapsTarget } from './builders/maps';
import { composeEmail } from './adapters/mail';
import {
  createContact,
  editContact,
  getContactFull,
  manageLimitedContactAccess,
  pickContact,
  searchContactsFull,
  shareContact,
  viewContact,
} from './adapters/contacts';
import { openExternalUrl } from './adapters/linking';
import { shareFile, shareText } from './adapters/share';
import { composeChat } from './adapters/chat';
import { composeSms } from './adapters/sms';
import { placePhoneCall, sendSms } from './adapters/telephony';
import {
  errorToNativeActionResult,
  makeActionResult,
  NativeActionError,
  NativeActionResult,
} from './types';
import { normalizeUrlWithAllowlist } from './validators';

export async function executeNativeAction(
  name: string,
  args: Record<string, unknown>,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    switch (name) {
      case 'email_compose':
        return composeEmail(args);
      case 'sms_compose':
        return composeSms(args as any);
      case 'sms_send':
        return sendSms(args as any);
      case 'chat_compose':
        return composeChat(args);
      case 'phone_call':
        return placePhoneCall({
          number: String(args.number || ''),
          defaultCountry: typeof args.defaultCountry === 'string' ? args.defaultCountry : undefined,
        });
      case 'maps_open': {
        const url = buildMapsUrl(args as any);
        return openExternalUrl(url, {
          summary: `Opened maps for ${summarizeMapsTarget(args as any)}.`,
          successCode: 'maps_opened',
        });
      }
      case 'contacts_pick':
        return pickContact();
      case 'contacts_manage_access':
        return manageLimitedContactAccess();
      case 'contacts_view':
        return viewContact(args as any);
      case 'contacts_edit':
        return editContact(args as any);
      case 'contacts_create':
        return createContact(args as any);
      case 'contacts_share':
        return shareContact(args as any);
      case 'contacts_search':
        return searchContactsFull(args as any);
      case 'contacts_get':
        return getContactFull(args as any);
      case 'share_text':
        return shareText(args as any);
      case 'share_file':
        return shareFile(args as any);
      case 'open_url': {
        const normalized = normalizeUrlWithAllowlist(args.url);
        return openExternalUrl(normalized.url, {
          summary: 'Opened the requested destination in the default app.',
          successCode: 'open_url_completed',
          details: { scheme: normalized.scheme },
        });
      }
      default:
        throw new NativeActionError('unknown_native_action', `Unknown native action: ${name}`);
    }
  } catch (error) {
    return errorToNativeActionResult(error, 'native_action_failed', `Native action ${name} failed`);
  }
}

export function serializeNativeActionResult(
  result: NativeActionResult<Record<string, unknown>>,
): string {
  const { executionStatus: _executionStatus, ...modelVisibleResult } = result;
  return JSON.stringify(modelVisibleResult);
}

export function serializeNativeActionSummary(
  status: string,
  summary: string,
  details?: Record<string, unknown>,
): string {
  return JSON.stringify(makeActionResult(status, summary, details));
}
