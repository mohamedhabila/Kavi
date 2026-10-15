// ---------------------------------------------------------------------------
// Kavi — Calls and texts placed for the person
// ---------------------------------------------------------------------------
// On Android Kavi places an approved call itself (the call permission; emergency numbers
// always go to the dialer) and sends an approved text itself while it is the phone's
// default assistant, the one use Google Play allows. When it cannot act directly, it does
// the closest thing that still helps: the dialer, a tap-to-call notification, or the
// composer with the message ready, and says why. iOS lets apps do neither directly.

import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

import { i18n } from '../../../i18n/manager';
import { normalizePhoneNumber, normalizePhoneNumberList } from '../builders/phone';
import {
  errorToNativeActionResult,
  makeActionFailure,
  makeActionResult,
  NativeActionError,
  type NativeActionResult,
  type PhoneCallArgs,
  SMS_SEND_MAX_MESSAGE_LENGTH,
  type SmsSendArgs,
} from '../types';
import { normalizeOptionalStringArray, normalizeRequiredString } from '../validators';
import { openExternalUrl } from './linking';
import { composeSms } from './sms';

export type SmsAccess = 'allowed' | 'assistant_role_needed' | 'permission_needed' | 'unavailable';

type CallOutcome = 'call_placed' | 'dialer_opened' | 'not_in_foreground' | 'unavailable';

type SmsRecipientResult = Readonly<{ recipient: string; status: string; error?: string }>;

type KaviPhoneNativeModule = {
  placeCall(number: string): Promise<CallOutcome>;
  postTapToCall(number: string, title: string, body: string, channelName: string): Promise<boolean>;
  getSmsAccess(): Promise<SmsAccess>;
  sendSms(
    recipients: string[],
    text: string,
  ): Promise<{ access: SmsAccess; results?: SmsRecipientResult[] }>;
};

function kaviPhone(): KaviPhoneNativeModule | undefined {
  if (Platform.OS !== 'android') return undefined;
  return NativeModules.KaviPhone as KaviPhoneNativeModule | undefined;
}

/** Whether Kavi may send a text itself on this phone right now. */
export async function getSmsAccess(): Promise<SmsAccess> {
  const phone = kaviPhone();
  return phone ? phone.getSmsAccess() : 'unavailable';
}

/** Asks for the call permission once; the native side opens the dialer without it. */
async function ensureCallPermission(): Promise<void> {
  const permission = PermissionsAndroid.PERMISSIONS.CALL_PHONE;
  if (await PermissionsAndroid.check(permission)) return;
  await PermissionsAndroid.request(permission);
}

/** Emergency and service numbers (911, 112, 311, *#06#): too short to be a phone number. */
const SHORT_DIALABLE_CODE = /^[0-9*#]{2,8}$/u;

function shortDialableCode(raw: string): string | undefined {
  const code = raw.replace(/[\s().-]/gu, '');
  return SHORT_DIALABLE_CODE.test(code) ? code : undefined;
}

/**
 * The person places these themselves from the dialer: Android lets only the dialer call
 * emergency numbers, and a short code is not a number Kavi can check.
 */
async function dialShortCode(code: string): Promise<NativeActionResult<Record<string, unknown>>> {
  return openExternalUrl(`tel:${encodeURIComponent(code)}`, {
    summary: `Opened the dialer with ${code}; the person places calls to emergency and service numbers themselves.`,
    successCode: 'phone_call_opened',
    details: { number: code },
  });
}

export async function placePhoneCall(
  args: PhoneCallArgs,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const raw = String(args.number || '');
    const code = shortDialableCode(raw);
    if (code) return dialShortCode(code);
    const normalized = normalizePhoneNumber(raw, args.defaultCountry);
    const details = { number: normalized.e164 };
    const phone = kaviPhone();
    if (!phone) {
      return openExternalUrl(normalized.telUri, {
        summary: `Opened the call screen for ${normalized.displayNumber}; the person confirms the call.`,
        successCode: 'phone_call_opened',
        details,
      });
    }
    await ensureCallPermission();
    switch (await phone.placeCall(normalized.e164)) {
      case 'call_placed':
        return makeActionResult(
          'call_placed',
          `Calling ${normalized.displayNumber}.`,
          details,
          'call_placed',
        );
      case 'dialer_opened':
        return makeActionResult(
          'opened',
          `Opened the dialer for ${normalized.displayNumber}; the person taps to call (emergency numbers, or Kavi has no call permission).`,
          details,
          'phone_call_opened',
        );
      case 'not_in_foreground': {
        const posted = await phone.postTapToCall(
          normalized.e164,
          i18n.t('notifications.callTitle', { number: normalized.displayNumber }),
          i18n.t('notifications.callBody'),
          i18n.t('notifications.callChannel'),
        );
        return posted
          ? makeActionResult(
              'call_notification_posted',
              `Kavi was not on screen, so Android would not start the call; it posted a notification that calls ${normalized.displayNumber} when tapped.`,
              details,
              'call_notification_posted',
            )
          : makeActionFailure(
              'notifications_off',
              "Kavi was not on screen, so Android would not start the call, and Kavi's notifications are off.",
              details,
              'unavailable',
            );
      }
      case 'unavailable':
        return makeActionFailure(
          'platform_unavailable',
          'This device cannot place phone calls.',
          details,
          'unavailable',
        );
    }
  } catch (error) {
    return errorToNativeActionResult(error, 'phone_call_failed', 'Unable to place the call');
  }
}

const COMPOSER_REASONS: Record<Exclude<SmsAccess, 'allowed'>, string> = {
  assistant_role_needed:
    "Kavi sends texts itself only as the phone's default assistant (Android Settings, Default apps, Digital assistant app); the composer is open with the message ready for the person to send.",
  permission_needed:
    'Kavi is the default assistant but its SMS permission is off; the composer is open with the message ready for the person to send.',
  unavailable:
    'This phone lets apps send texts only through the composer; it is open with the message ready for the person to send.',
};

async function composeInstead(
  recipients: string[],
  message: string,
  access: Exclude<SmsAccess, 'allowed'>,
): Promise<NativeActionResult<Record<string, unknown>>> {
  const composed = await composeSms({ recipients, message });
  if (composed.executionStatus !== 'completed') return composed;
  // iOS reports a send the person made from the composer; Android reports nothing.
  return {
    ...composed,
    status: composed.status === 'sent' ? 'sent' : 'composer_opened',
    summary: COMPOSER_REASONS[access],
    details: { ...composed.details, sentDirectly: false, reason: access },
  };
}

function summarizeSends(
  results: ReadonlyArray<SmsRecipientResult>,
): NativeActionResult<Record<string, unknown>> {
  const count = (status: string) => results.filter((result) => result.status === status).length;
  const sent = count('sent');
  const unconfirmed = count('unknown');
  const details = { recipients: results.map((result) => ({ ...result })) };
  if (sent === results.length) {
    return makeActionResult('sent', `Sent the text to ${sent} recipient(s).`, details, 'sms_sent');
  }
  if (sent + unconfirmed === results.length) {
    return makeActionResult(
      'sent_unconfirmed',
      'The phone accepted the text, but the network has not confirmed every part yet.',
      details,
      'sms_sent_unconfirmed',
    );
  }
  if (sent + unconfirmed > 0) {
    return makeActionResult(
      'partially_sent',
      'Some recipients got the text and some did not; each recipient has its own result.',
      details,
      'sms_partially_sent',
    );
  }
  return makeActionFailure(
    'sms_send_failed',
    'The phone could not send the text; each recipient has the reason.',
    details,
  );
}

export async function sendSms(
  args: SmsSendArgs,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const recipients = normalizePhoneNumberList(
      normalizeOptionalStringArray(args.recipients, 'recipients') || [],
      'recipients',
      args.defaultCountry,
    );
    if (recipients.length === 0) {
      throw new NativeActionError(
        'invalid_arguments',
        'recipients must contain at least one phone number.',
      );
    }
    const message = normalizeRequiredString(args.message, 'message');
    if (message.length > SMS_SEND_MAX_MESSAGE_LENGTH) {
      throw new NativeActionError(
        'invalid_arguments',
        `message must be at most ${SMS_SEND_MAX_MESSAGE_LENGTH} characters.`,
      );
    }
    const phone = kaviPhone();
    const access = phone ? await phone.getSmsAccess() : 'unavailable';
    if (!phone || access !== 'allowed') {
      return composeInstead(recipients, message, access === 'allowed' ? 'unavailable' : access);
    }
    const sent = await phone.sendSms(recipients, message);
    if (sent.access !== 'allowed') return composeInstead(recipients, message, sent.access);
    return summarizeSends(sent.results ?? []);
  } catch (error) {
    return errorToNativeActionResult(error, 'sms_send_failed', 'Unable to send the text');
  }
}
