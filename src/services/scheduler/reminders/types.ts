// ---------------------------------------------------------------------------
// Kavi — Reminder Types
// ---------------------------------------------------------------------------
// A reminder is a personal, OS-delivered notification: unlike a cron job, it
// never resumes a conversation. The operating system fires it directly from a
// native trigger, so delivery does not depend on the app being foregrounded.

/**
 * `at` is an ISO-8601 date-time, either carrying an explicit UTC offset (or
 * `Z`) — in which case it names an absolute instant independent of
 * `timezone` — or offset-less (e.g. "2026-09-10T14:00:00"), in which case it
 * is a local wall-clock time resolved against `timezone` (DST-correct; see
 * recurrence.ts's resolveOnceSchedule / zonedTime.ts).
 * `time` is a 24-hour `HH:MM` wall-clock time evaluated in `timezone`.
 * `weekday` is ISO-8601 (1=Monday .. 7=Sunday). `dayOfMonth` is 1-31; months
 * shorter than the requested day are skipped, matching standard cron semantics.
 */
export type ReminderRecurrence =
  | { kind: 'once'; at: string }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; time: string; weekday: number }
  | { kind: 'monthly'; time: string; dayOfMonth: number };

export type ReminderRecurrenceKind = ReminderRecurrence['kind'];

export type ReminderStatus = 'pending' | 'fired' | 'cancelled';

export interface ReminderRecord {
  id: string;
  title: string;
  notes?: string;
  recurrence: ReminderRecurrence;
  /** IANA time zone the recurrence is evaluated in. */
  timezone: string;
  status: ReminderStatus;
  /**
   * Best-known next fire time in epoch ms. Authoritative (kept in sync by the
   * reconcile pass) for `once`/`monthly`, which use a single re-armed native
   * DATE trigger. For `daily`/`weekly`/`weekdays`, the OS trigger repeats on
   * its own; callers should recompute a live value for display instead of
   * trusting this column, which is only refreshed at create/update time.
   */
  nextFireAtMs?: number;
  /**
   * The instant the currently scheduled native DATE trigger targets. Only
   * meaningful for `once`/`monthly`; used to detect when that trigger has
   * elapsed and the next occurrence needs to be re-armed.
   */
  armedForMs?: number;
  /** OS-assigned identifiers for the trigger(s) backing this reminder. */
  notificationIds: string[];
  createdAtMs: number;
  updatedAtMs: number;
}
