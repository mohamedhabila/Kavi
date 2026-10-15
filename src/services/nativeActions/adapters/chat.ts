// ---------------------------------------------------------------------------
// Kavi — A messaging app's chat with the message already typed
// ---------------------------------------------------------------------------
// WhatsApp and Telegram open a person's exact chat with a draft through their own links,
// which open the installed app (or their web page when it is not installed): the person
// sees the message and taps send. Neither app lets another app send for them.

import { normalizePhoneNumber } from '../builders/phone';
import {
  CHAT_COMPOSE_APPS,
  type ChatComposeApp,
  errorToNativeActionResult,
  NativeActionError,
  type NativeActionResult,
} from '../types';
import { normalizeRequiredString } from '../validators';
import { openExternalUrl } from './linking';

/** WhatsApp's click-to-chat link, and Telegram's link to a chat by phone number. */
function chatUrl(app: ChatComposeApp, e164: string, message: string): string {
  const text = encodeURIComponent(message);
  return app === 'whatsapp'
    ? `https://wa.me/${e164.slice(1)}?text=${text}`
    : `https://t.me/+${e164.slice(1)}?text=${text}`;
}

const APP_NAMES: Record<ChatComposeApp, string> = { whatsapp: 'WhatsApp', telegram: 'Telegram' };

export async function composeChat(
  args: Record<string, unknown>,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const app = args.app;
    if (!CHAT_COMPOSE_APPS.includes(app as ChatComposeApp)) {
      throw new NativeActionError(
        'invalid_arguments',
        `app must be one of ${CHAT_COMPOSE_APPS.join(', ')}.`,
      );
    }
    const chatApp = app as ChatComposeApp;
    const number = normalizePhoneNumber(
      normalizeRequiredString(args.phoneNumber, 'phoneNumber'),
      typeof args.defaultCountry === 'string' ? args.defaultCountry : undefined,
    );
    const message = normalizeRequiredString(args.message, 'message');
    return openExternalUrl(chatUrl(chatApp, number.e164, message), {
      summary: `Opened the ${APP_NAMES[chatApp]} chat with ${number.displayNumber}, the message typed in; the person taps send.`,
      successCode: 'chat_opened',
      details: { app: chatApp, number: number.e164 },
    });
  } catch (error) {
    return errorToNativeActionResult(error, 'chat_compose_failed', 'Unable to open the chat');
  }
}
