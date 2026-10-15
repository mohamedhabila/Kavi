// ---------------------------------------------------------------------------
// Kavi — Notification Reader
// ---------------------------------------------------------------------------
// On Android, once the person turns on notification access for Kavi in the system settings,
// Kavi can read back what other apps announced (a message, a delivery, a reminder) when asked.
// The phone keeps them in memory only, from when access was granted; iOS offers no such access.

import { NativeModules, Platform } from 'react-native';

export type NotificationAccessState = 'granted' | 'not_granted' | 'unavailable';

export type ReadNotification = Readonly<{
  /** Stable for as long as the notification lives; what a reply names. */
  id: string;
  app: string;
  packageName: string;
  title: string;
  text: string;
  /** Epoch milliseconds. */
  postedAt: number;
  /** Still in the notification shade. */
  showing: boolean;
  /** Its app offers a reply that takes typed text, so Kavi can answer from it. */
  canReply: boolean;
}>;

export type NotificationReplyStatus =
  | 'sent'
  | 'not_showing'
  | 'no_reply_action'
  | 'expired'
  | 'not_granted'
  | 'unavailable';

export type NotificationReplyResult = Readonly<{
  status: NotificationReplyStatus;
  /** The app and conversation replied to, when Kavi still knows the notification. */
  app?: string;
  title?: string;
}>;

export type RecentNotifications = Readonly<{
  access: NotificationAccessState;
  notifications: ReadonlyArray<ReadNotification>;
}>;

type NotificationReaderNativeModule = {
  getAccessState(): Promise<'granted' | 'not_granted'>;
  openAccessSettings(): Promise<boolean>;
  readRecent(
    sinceMs: number,
    limit: number,
  ): Promise<{ access: 'granted' | 'not_granted'; notifications: ReadNotification[] }>;
  describe(id: string): Promise<{ app: string; title: string } | null>;
  reply(id: string, text: string): Promise<NotificationReplyResult>;
};

function readerModule(): NotificationReaderNativeModule | undefined {
  if (Platform.OS !== 'android') return undefined;
  return NativeModules.KaviNotificationReader as NotificationReaderNativeModule | undefined;
}

export async function getNotificationAccessState(): Promise<NotificationAccessState> {
  const nativeModule = readerModule();
  if (!nativeModule) return 'unavailable';
  return nativeModule.getAccessState();
}

/** Opens the system page where the person turns notification access on; false if none opens. */
export async function openNotificationAccessSettings(): Promise<boolean> {
  const nativeModule = readerModule();
  if (!nativeModule) return false;
  return nativeModule.openAccessSettings();
}

/** The notifications posted since `sinceMs`, newest first. */
export async function readRecentNotifications(
  sinceMs: number,
  limit: number,
): Promise<RecentNotifications> {
  const nativeModule = readerModule();
  if (!nativeModule) return { access: 'unavailable', notifications: [] };
  const result = await nativeModule.readRecent(sinceMs, limit);
  return { access: result.access, notifications: result.notifications };
}

/** Which app and conversation the notification [id] is from; null when Kavi does not know it. */
export async function describeNotification(
  id: string,
): Promise<{ app: string; title: string } | null> {
  const nativeModule = readerModule();
  if (!nativeModule) return null;
  return nativeModule.describe(id);
}

/**
 * Replies to the notification [id] with [text] through its app's own reply action, as the
 * person would from the notification shade. Works only while the notification still shows.
 */
export async function replyToNotification(
  id: string,
  text: string,
): Promise<NotificationReplyResult> {
  const nativeModule = readerModule();
  if (!nativeModule) return { status: 'unavailable' };
  return nativeModule.reply(id, text);
}
