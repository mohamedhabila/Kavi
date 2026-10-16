// ---------------------------------------------------------------------------
// Kavi — How a call Kavi handles is going, and what was said
// ---------------------------------------------------------------------------
// Bland reports a call as not completed until it ends; then `status` says how it ended
// (completed, busy, no-answer, failed, canceled, unknown) and the transcript, summary,
// length and price are final. Waiting is bounded and backs off, so following a call costs
// a model turn every minute or two, not a turn every few seconds.

import { getBlandCall } from './blandClient';

export const MAX_WAIT_SECONDS = 120;
const DEFAULT_WAIT_SECONDS = 60;
/** Checks start every 5 seconds and back off to every 15. */
const FIRST_POLL_MS = 5_000;
const MAX_POLL_MS = 15_000;
const MAX_TRANSCRIPT_LINES = 60;
const MAX_LINE_CHARS = 500;
const MAX_TRANSCRIPT_CHARS = 8_000;

const QUEUE_ERRORS = new Set(['pre_queue_error', 'queue_error', 'call_error', 'complete_error']);

export type AgentCallLine = Readonly<{ speaker: 'kavi' | 'them'; text: string }>;

export type AgentCallReport = Readonly<{
  /** in_progress until the call ends; ended once Bland has the final record. */
  status: 'in_progress' | 'ended' | 'failed';
  callId: string;
  /** How it ended: completed, busy, no-answer, failed, canceled or unknown. */
  outcome?: string;
  queueStatus?: string;
  answeredBy?: string;
  endedBy?: string;
  minutes?: number;
  priceUsd?: number;
  summary?: string;
  transcript: ReadonlyArray<AgentCallLine>;
  /** Earlier lines left out to keep the report bounded. */
  transcriptLinesOmitted?: number;
  recordingUrl?: string;
  error?: string;
}>;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
}

/** The spoken lines, newest kept when the call ran long. */
function transcriptOf(value: unknown): { lines: AgentCallLine[]; omitted: number } {
  if (!Array.isArray(value)) return { lines: [], omitted: 0 };
  const spoken = value.flatMap((entry): AgentCallLine[] => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const said = text(record.text);
    if (!said) return [];
    const speaker = record.user === 'assistant' ? 'kavi' : record.user === 'user' ? 'them' : null;
    return speaker ? [{ speaker, text: Array.from(said).slice(0, MAX_LINE_CHARS).join('') }] : [];
  });
  const kept: AgentCallLine[] = [];
  let chars = 0;
  for (
    let index = spoken.length - 1;
    index >= 0 && kept.length < MAX_TRANSCRIPT_LINES;
    index -= 1
  ) {
    const line = spoken[index]!;
    chars += line.text.length;
    if (chars > MAX_TRANSCRIPT_CHARS) break;
    kept.unshift(line);
  }
  return { lines: kept, omitted: spoken.length - kept.length };
}

/** Bland's call record, as Kavi reports it. */
export function reportFromBlandCall(
  callId: string,
  call: Record<string, unknown>,
): AgentCallReport {
  const queueStatus = text(call.queue_status);
  const completed = call.completed === true;
  const error = text(call.error_message);
  const { lines, omitted } = transcriptOf(call.transcripts);
  const status =
    queueStatus && QUEUE_ERRORS.has(queueStatus) ? 'failed' : completed ? 'ended' : 'in_progress';
  const answeredBy = text(call.answered_by);
  const endedBy = text(call.call_ended_by);
  const minutes = finiteNumber(call.call_length);
  const priceUsd = finiteNumber(call.price);
  const summary = text(call.summary);
  const recordingUrl = text(call.recording_url);
  const outcome = completed ? text(call.status) : undefined;
  return {
    status,
    callId,
    ...(outcome ? { outcome } : {}),
    ...(queueStatus ? { queueStatus } : {}),
    ...(answeredBy ? { answeredBy } : {}),
    ...(endedBy ? { endedBy } : {}),
    ...(minutes !== undefined ? { minutes } : {}),
    ...(priceUsd !== undefined ? { priceUsd } : {}),
    ...(summary ? { summary } : {}),
    transcript: lines,
    ...(omitted > 0 ? { transcriptLinesOmitted: omitted } : {}),
    ...(recordingUrl?.startsWith('https://') ? { recordingUrl } : {}),
    ...(error ? { error } : {}),
  };
}

export function waitSecondsFrom(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_WAIT_SECONDS;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_WAIT_SECONDS;
  return Math.min(MAX_WAIT_SECONDS, Math.max(0, Math.round(seconds)));
}

function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done);
  });
}

/**
 * The call's report once it has ended, or after [waitSeconds] (0 reads it once). Returns
 * early when the run is stopped, with the latest report.
 */
export async function followAgentCall(
  callId: string,
  waitSeconds: number,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<AgentCallReport> {
  const deadline = now() + waitSeconds * 1_000;
  let interval = FIRST_POLL_MS;
  for (;;) {
    const report = reportFromBlandCall(callId, await getBlandCall(callId, signal, fetchImpl));
    const remaining = deadline - now();
    if (report.status !== 'in_progress' || remaining <= 0 || signal?.aborted) return report;
    await pause(Math.min(interval, remaining), signal);
    if (signal?.aborted) return report;
    interval = Math.min(MAX_POLL_MS, interval * 1.5);
  }
}
