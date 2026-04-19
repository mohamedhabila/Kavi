import { buildMapsUrl, summarizeMapsTarget } from './builders/maps';
import { normalizePhoneNumber } from './builders/phone';
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
import { shareFile, shareText, shareUrl } from './adapters/share';
import { composeSms } from './adapters/sms';
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
      case 'phone_call': {
        const normalized = normalizePhoneNumber(
          String(args.number || ''),
          typeof args.defaultCountry === 'string' ? args.defaultCountry : undefined,
        );
        return openExternalUrl(normalized.telUri, {
          summary: `Opened the dialer for ${normalized.displayNumber}.`,
          successCode: 'phone_call_opened',
          details: { number: normalized.e164 },
        });
      }
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
      case 'share_contact':
        return shareContact(args as any);
      case 'contacts_search_full':
      case 'contacts_search':
        return searchContactsFull(args as any);
      case 'contacts_get_full':
      case 'contacts_get':
        return getContactFull(args as any);
      case 'share_text':
        return shareText(args as any);
      case 'share_url':
        return shareUrl(args as any);
      case 'share_file':
        return shareFile(args as any);
      case 'share':
        if (typeof args.url === 'string') {
          return shareUrl({
            url: args.url,
            message: typeof args.text === 'string' ? args.text : undefined,
            title: typeof args.title === 'string' ? args.title : undefined,
          });
        }
        return shareText({
          text: String(args.text || ''),
          title: typeof args.title === 'string' ? args.title : undefined,
        });
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
  return JSON.stringify(result);
}

export function serializeNativeActionSummary(
  status: string,
  summary: string,
  details?: Record<string, unknown>,
): string {
  return JSON.stringify(makeActionResult(status, summary, details));
}
