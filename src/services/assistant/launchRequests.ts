// ---------------------------------------------------------------------------
// Kavi — Launch Requests
// ---------------------------------------------------------------------------
// Ways the system opens Kavi for something specific, all expressed as kavi:// links:
//   kavi://assist          the phone's assistant gesture (Android) or "Talk to Kavi" (Siri,
//                          Shortcuts, the Action button): open voice, listening.
//   kavi://ask?text=…      "Ask Kavi" with a request (Siri, Shortcuts): send it.
//   kavi://expo-sharing    another app shared something into Kavi: show the conversation,
//                          whose composer takes the shared items.
// On Android the links arrive through Linking. On iOS an App Intent leaves the link in a
// native slot (KaviLaunchRequests), because an intent that opens the app has no launch URL.

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

export type LaunchRequest =
  | Readonly<{ kind: 'voice' }>
  | Readonly<{ kind: 'ask'; text: string }>
  | Readonly<{ kind: 'share' }>;

/** The longest request an "Ask Kavi" link may carry; longer text is cut at this length. */
export const MAX_LAUNCH_REQUEST_TEXT_LENGTH = 4_000;

const ASSIST_LINK = 'kavi://assist';
const SHARE_LINK = 'kavi://expo-sharing';
const ASK_LINK_PREFIX = 'kavi://ask?text=';

function decodeQueryValue(value: string): string | undefined {
  try {
    return decodeURIComponent(value.replace(/\+/gu, ' '));
  } catch {
    return undefined;
  }
}

/** The request a kavi:// launch link carries, or null for any other link. */
export function parseLaunchRequestUrl(url: string | null | undefined): LaunchRequest | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  const link = trimmed.toLowerCase().replace(/\/+$/u, '');
  if (link === ASSIST_LINK) return { kind: 'voice' };
  if (link === SHARE_LINK) return { kind: 'share' };
  if (!trimmed.toLowerCase().startsWith(ASK_LINK_PREFIX)) return null;
  const encoded = trimmed.slice(ASK_LINK_PREFIX.length).split('&')[0] ?? '';
  const text = decodeQueryValue(encoded)?.trim();
  if (!text) return null;
  return { kind: 'ask', text: [...text].slice(0, MAX_LAUNCH_REQUEST_TEXT_LENGTH).join('') };
}

type LaunchRequestsNativeModule = {
  consumePendingLaunchRequest(): Promise<string | null>;
};

/** iOS: the App Intents' pending launch link, and an emitter that says one arrived. */
export function iosLaunchRequestSource():
  | Readonly<{
      consume: () => Promise<string | null>;
      emitter: NativeEventEmitter;
    }>
  | undefined {
  if (Platform.OS !== 'ios') return undefined;
  const nativeModule = NativeModules.KaviLaunchRequests as LaunchRequestsNativeModule | undefined;
  if (!nativeModule) return undefined;
  return {
    consume: () => nativeModule.consumePendingLaunchRequest(),
    emitter: new NativeEventEmitter(NativeModules.KaviLaunchRequests),
  };
}

/** The event the iOS module sends when an App Intent left a launch request. */
export const IOS_LAUNCH_REQUEST_EVENT = 'KaviLaunchRequest';
