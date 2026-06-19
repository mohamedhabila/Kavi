// ---------------------------------------------------------------------------
// Kavi — Chat temporal markers
// ---------------------------------------------------------------------------
// Pure derivation of human-readable temporal markers between adjacent
// messages, per the single-thread/living-memory.
//
// Markers are *derived* — never persisted. Callers feed in the message list
// and a `now` clock; the helper returns the marker (if any) that should be
// rendered immediately *before* each message.
//
// Bucketing rules (deterministic, locale-aware via Intl):
//
//   • First message of the entire thread     → "Conversation began <date>"
//   • Crosses local midnight from prev       → day separator: "Today" /
//                                                "Yesterday" / weekday / date
//   • ≥ 4 hours, same calendar day as prev   → "Later that day · 2:14 PM"
//   • ≥ 30 minutes, < 4 hours, same day      → soft inline timestamp
//   • Cold-start cue (first msg after gap >= 30 min)
//     when caller passes `coldStartGapMs`    → "Continuing — last spoke
//                                                ~Nh ago"
//   • Otherwise                              → no marker
//
// This module is intentionally side-effect-free; rendering is the caller's job.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';

export type TemporalMarkerKind =
  | 'thread-start'
  | 'day-separator'
  | 'later-that-day'
  | 'soft-timestamp'
  | 'cold-start-cue';

export interface TemporalMarker {
  kind: TemporalMarkerKind;
  /** ID of the message this marker should appear *before*. */
  beforeMessageId: string;
  /** Pre-formatted, localized text safe for direct rendering. */
  text: string;
  /** Raw values for callers who want to format their own way. */
  meta: {
    timestamp: number;
    gapMs?: number;
  };
}

export interface ComputeTemporalMarkersOptions {
  /** Wall-clock now (ms). Defaults to `Date.now()`. Required for cold-start cue. */
  now?: number;
  /**
   * If the time between `now` and the *last* message exceeds this threshold,
   * a `cold-start-cue` marker is prepended before the next user message.
   * Defaults to 30 minutes.
   */
  coldStartGapMs?: number;
  /** BCP-47 locale tag for date/time formatting. Defaults to 'en-US'. */
  locale?: string;
}

const DEFAULT_COLD_START_GAP_MS = 30 * 60_000;
const FOUR_HOURS_MS = 4 * 60 * 60_000;
const THIRTY_MINUTES_MS = 30 * 60_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function daysBetween(prevTs: number, currTs: number): number {
  return Math.round((startOfDay(currTs) - startOfDay(prevTs)) / 86_400_000);
}

function formatDay(ts: number, now: number, locale: string): string {
  const days = daysBetween(now, ts);
  if (days === 0) return 'Today';
  if (days === -1) return 'Yesterday';
  if (days < 0 && days >= -6) {
    return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(ts));
  }
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(ts));
}

function formatTime(ts: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ts));
}

function bucketGapPhrase(gapMs: number): string {
  const hours = Math.round(gapMs / 3_600_000);
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(gapMs / 60_000));
    return `~${minutes}m ago`;
  }
  if (hours < 24) return `~${hours}h ago`;
  const days = Math.max(1, Math.round(gapMs / 86_400_000));
  return `~${days}d ago`;
}

export function computeTemporalMarkers(
  messages: ReadonlyArray<Pick<Message, 'id' | 'role' | 'timestamp'>>,
  options: ComputeTemporalMarkersOptions = {},
): TemporalMarker[] {
  if (messages.length === 0) return [];

  const now = options.now ?? Date.now();
  const locale = options.locale ?? 'en-US';
  const coldStartGapMs = options.coldStartGapMs ?? DEFAULT_COLD_START_GAP_MS;

  const markers: TemporalMarker[] = [];

  // Thread-start marker before the very first message.
  const first = messages[0];
  markers.push({
    kind: 'thread-start',
    beforeMessageId: first.id,
    text: `Conversation began ${new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(first.timestamp))}`,
    meta: { timestamp: first.timestamp },
  });

  for (let i = 1; i < messages.length; i += 1) {
    const prev = messages[i - 1];
    const curr = messages[i];
    if (
      typeof prev.timestamp !== 'number' ||
      typeof curr.timestamp !== 'number' ||
      curr.timestamp < prev.timestamp
    ) {
      continue;
    }
    const gap = curr.timestamp - prev.timestamp;
    const crossesMidnight = startOfDay(prev.timestamp) !== startOfDay(curr.timestamp);

    if (crossesMidnight) {
      markers.push({
        kind: 'day-separator',
        beforeMessageId: curr.id,
        text: formatDay(curr.timestamp, now, locale),
        meta: { timestamp: curr.timestamp, gapMs: gap },
      });
      continue;
    }

    if (gap >= FOUR_HOURS_MS) {
      markers.push({
        kind: 'later-that-day',
        beforeMessageId: curr.id,
        text: `Later that day · ${formatTime(curr.timestamp, locale)}`,
        meta: { timestamp: curr.timestamp, gapMs: gap },
      });
      continue;
    }

    if (gap >= THIRTY_MINUTES_MS) {
      markers.push({
        kind: 'soft-timestamp',
        beforeMessageId: curr.id,
        text: formatTime(curr.timestamp, locale),
        meta: { timestamp: curr.timestamp, gapMs: gap },
      });
    }
  }

  // Cold-start cue: when the user is returning after a long gap relative to `now`,
  // prepend a gentle inline note before the next *user* message they'll send.
  // We surface it on the LAST message in the buffer so the caller can render the
  // cue immediately above the composer when the gap is large enough.
  const last = messages[messages.length - 1];
  if (typeof last.timestamp === 'number') {
    const gapToNow = now - last.timestamp;
    if (gapToNow >= coldStartGapMs) {
      markers.push({
        kind: 'cold-start-cue',
        beforeMessageId: last.id,
        text: `Continuing — last spoke ${bucketGapPhrase(gapToNow)}`,
        meta: { timestamp: now, gapMs: gapToNow },
      });
    }
  }

  return markers;
}
