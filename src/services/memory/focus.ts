// ---------------------------------------------------------------------------
// Kavi — Focus header
// ---------------------------------------------------------------------------
// Renders the per-turn `<focus>` block that anchors the assistant to:
//   • Time since the last assistant response (bucketed for cache friendliness).
//   • Active focus (rolling summary of what the user is working on).
//   • Open threads (most recent unresolved follow-ups first).
//   • Notable since last turn (only when the consolidator added new facts).
//
// Design rules:
//   • The block sits AFTER the cache breakpoint — it is OK for it to vary.
//   • We render BUCKETED phrases (not literal timestamps) so multi-turn bursts
//     within one bucket are byte-identical and reuse the trailing tail bytes
//     even on providers that hash the entire payload.
//   • The block is anchored on the LAST ASSISTANT RESPONSE timestamp, not the
//     last user message — that is the user request explicitly.
//   • Empty subsections are omitted to keep the block tight.
// ---------------------------------------------------------------------------

export type FocusGapBucket =
  | 'live'
  | 'short_break'
  | 'longer_break'
  | 'later_today'
  | 'yesterday'
  | 'this_week'
  | 'extended_break';

export interface FocusGap {
  bucket: FocusGapBucket;
  /** Human-readable phrase for the prompt; empty string if no cue should render. */
  phrase: string;
  /** Raw gap in milliseconds (for downstream logic — never rendered). */
  gapMs: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Bucket the gap between `now` and the focus anchor (last assistant timestamp,
 * else last user timestamp, else thread creation). Bucket boundaries are
 * intentionally coarse so the rendered phrase stays byte-stable across many
 * back-to-back turns within the same bucket.
 */
export function bucketFocusGap(args: {
  now: number;
  focusAnchor: number;
  /** Hour-of-day for the focus anchor in the user's local TZ (0-23). */
  anchorHour?: number;
  /** Minute-of-hour for the focus anchor in the user's local TZ (0-59). */
  anchorMinute?: number;
  /** Weekday name for the focus anchor (e.g. "Monday"). */
  anchorWeekday?: string;
  /** Local-date string for the focus anchor (e.g. "Mar 25"). */
  anchorDateLabel?: string;
}): FocusGap {
  const gapMs = Math.max(0, args.now - args.focusAnchor);

  if (gapMs < 2 * MIN) {
    return { bucket: 'live', phrase: '', gapMs };
  }
  if (gapMs < 15 * MIN) {
    return {
      bucket: 'short_break',
      phrase: 'picking up the conversation',
      gapMs,
    };
  }
  if (gapMs < 2 * HOUR) {
    const minutes = Math.round(gapMs / MIN);
    return {
      bucket: 'longer_break',
      phrase: `back after a short break (~${minutes}m)`,
      gapMs,
    };
  }
  if (gapMs < DAY) {
    const hours = Math.round(gapMs / HOUR);
    const stamp = formatClock(args.anchorHour, args.anchorMinute);
    const stampPart = stamp ? `, was ${stamp}` : '';
    return {
      bucket: 'later_today',
      phrase: `back later today (~${hours}h ago${stampPart})`,
      gapMs,
    };
  }
  if (gapMs < 2 * DAY) {
    const stamp = formatClock(args.anchorHour, args.anchorMinute);
    const stampPart = stamp ? ` (last spoke yesterday ${stamp})` : ' (last spoke yesterday)';
    return {
      bucket: 'yesterday',
      phrase: `back the next day${stampPart}`,
      gapMs,
    };
  }
  if (gapMs < 7 * DAY) {
    const days = Math.max(2, Math.round(gapMs / DAY));
    return {
      bucket: 'this_week',
      phrase: `back after ${days} days`,
      gapMs,
    };
  }
  const weekdayPart = args.anchorWeekday ? `, ${args.anchorWeekday}` : '';
  const datePart = args.anchorDateLabel ? `, ${args.anchorDateLabel}` : '';
  const tail = weekdayPart || datePart ? ` (last spoke${weekdayPart}${datePart})` : '';
  return {
    bucket: 'extended_break',
    phrase: `back after a longer break${tail}`,
    gapMs,
  };
}

function formatClock(hour: number | undefined, minute: number | undefined): string {
  if (hour === undefined || minute === undefined) return '';
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
  const h = ((Math.floor(hour) + 23) % 12) + 1;
  const m = String(Math.floor(minute)).padStart(2, '0');
  const suffix = Math.floor(hour) < 12 ? 'am' : 'pm';
  return `${h}:${m}${suffix}`;
}

export interface FocusBlockInput {
  now: number;
  /** Last assistant response timestamp (preferred). Falls back to last user, then thread creation. */
  lastAssistantAt?: number | null;
  lastUserAt?: number | null;
  threadCreatedAt: number;
  /** Content of the active_focus memory block (rolling summary). */
  activeFocus?: string | null;
  /** Open thread labels, most recent first. We render up to 5. */
  openThreads?: string[];
  /** Set when the consolidator extracted a new fact since the previous request. */
  notableSinceLastTurn?: string[];
  /** Optional anchor formatting hints (renderer is TZ-agnostic). */
  anchorHour?: number;
  anchorMinute?: number;
  anchorWeekday?: string;
  anchorDateLabel?: string;
  /** When true, omit the wrapping `<focus>` tag — useful for embedding in a parent block. */
  bare?: boolean;
}

export interface FocusBlockOutput {
  /** Final string ready to inject into the prompt. Empty string when nothing to render. */
  text: string;
  gap: FocusGap;
}

const MAX_OPEN_THREADS = 5;
const MAX_NOTABLE_LINES = 2;
const ACTIVE_FOCUS_MAX_CHARS = 600;
export const ACTIVE_FOCUS_MEMORY_CHAR_LIMIT = 800;

export function composeActiveFocusContent(params: {
  threadTitle?: string | null;
  activeFocus?: string | null;
  maxChars?: number;
}): string {
  const maxChars = Math.max(0, params.maxChars ?? ACTIVE_FOCUS_MEMORY_CHAR_LIMIT);
  const threadTitle = params.threadTitle?.trim() ?? '';
  const activeFocus = params.activeFocus?.trim() ?? '';
  const content =
    threadTitle && activeFocus && !activeFocus.includes(threadTitle)
      ? `${threadTitle}\n${activeFocus}`
      : activeFocus || threadTitle;
  return content.slice(0, maxChars).trim();
}

/**
 * Render the `<focus>` block. Returns an empty string when there is nothing
 * worth saying (live conversation, no active focus, no open threads, no
 * notable updates). Empty output is preferred over a noisy token-spending
 * placeholder.
 */
export function renderFocusBlock(input: FocusBlockInput): FocusBlockOutput {
  const focusAnchor =
    typeof input.lastAssistantAt === 'number'
      ? input.lastAssistantAt
      : typeof input.lastUserAt === 'number'
        ? input.lastUserAt
        : input.threadCreatedAt;

  const gap = bucketFocusGap({
    now: input.now,
    focusAnchor,
    anchorHour: input.anchorHour,
    anchorMinute: input.anchorMinute,
    anchorWeekday: input.anchorWeekday,
    anchorDateLabel: input.anchorDateLabel,
  });

  const lines: string[] = [];
  if (gap.phrase) lines.push(gap.phrase);

  const activeFocus = (input.activeFocus ?? '').trim();
  if (activeFocus) {
    const trimmed = activeFocus.length > ACTIVE_FOCUS_MAX_CHARS
      ? `${activeFocus.slice(0, ACTIVE_FOCUS_MAX_CHARS - 1).trimEnd()}\u2026`
      : activeFocus;
    lines.push(`Recently we were: ${trimmed}`);
  }

  const openThreads = (input.openThreads ?? [])
    .map((label) => label.trim())
    .filter((label): label is string => label.length > 0)
    .slice(0, MAX_OPEN_THREADS);
  if (openThreads.length > 0) {
    const rendered = openThreads.map((label) => `- ${label}`).join('\n');
    lines.push(`Open threads (most recent first):\n${rendered}`);
  }

  const notable = (input.notableSinceLastTurn ?? [])
    .map((line) => line.trim())
    .filter((line): line is string => line.length > 0)
    .slice(0, MAX_NOTABLE_LINES);
  if (notable.length > 0) {
    const rendered = notable.map((line) => `- ${line}`).join('\n');
    lines.push(`Notable since last turn:\n${rendered}`);
  }

  if (lines.length === 0) {
    return { text: '', gap };
  }

  const body = lines.join('\n');
  return {
    text: input.bare ? body : `<focus>\n${body}\n</focus>`,
    gap,
  };
}
