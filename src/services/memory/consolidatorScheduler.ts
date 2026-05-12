// ---------------------------------------------------------------------------
// Memory consolidation scheduler
// ---------------------------------------------------------------------------
// Decides WHEN to run the consolidator on a per-thread basis. Triggers:
//
//   1. Turn-count: ≥ N (default 8) new turns since `last_consolidated_message_id`,
//      and the most recent turn is an `assistant` message (i.e. closed turn).
//   2. Idle: ≥ M (default 10 minutes) since the last assistant turn, with at
//      least one new turn since the last consolidation.
//   3. App-background: explicit caller-driven flush of all dirty threads when
//      the app moves to background.
//
// Gating:
//   • The scheduler is a NO-OP when no `consolidationProvider` is configured
//     in `useSettingsStore`. On-device users opt in by leaving it null/empty.
//
// Persistence:
//   • Per-thread state lives in the `memory_consolidation_state` SQLite table
//     (schema bootstrapped in services/memory/schema.ts). Rows store the last
//     consolidated message id and timestamp so triggers survive app restarts.
//
// The scheduler is intentionally pure-ish:
//   - It does NOT pick the LLM provider — callers supply the extractor.
//   - It does NOT mutate `messages` — callers pass the live transcript.
//   - It does NOT throw into the chat path — every public call resolves.
// ---------------------------------------------------------------------------

import type { Message } from '../../types';
import { createLogger } from '../../utils/logger';
import {
  isAssistantFinalResponsePlaceholder,
  isFinalAssistantMessage,
} from '../../utils/assistantMessageMetadata';
import {
  consolidateTurn,
  type ConsolidatorExtractor,
  type ConsolidatorOptions,
  type ConsolidatorResult,
  type ConsolidatorTurnInput,
} from './consolidator';
import { ensureFactSchema } from './schema';
import { getMemoryDb } from './sqlite-store';

const logger = createLogger('memory.consolidatorScheduler');

export const DEFAULT_TURN_THRESHOLD = 8;
export const DEFAULT_IDLE_THRESHOLD_MS = 10 * 60 * 1000;

export type ConsolidationTriggerReason =
  | 'turn_threshold'
  | 'idle_threshold'
  | 'app_background'
  | 'manual';

export interface ConsolidationStateRow {
  threadId: string;
  lastConsolidatedMessageId: string | null;
  lastConsolidatedAt: number;
  turnsSinceLast: number;
  updatedAt: number;
}

interface ConsolidationStateRowDb {
  thread_id: string;
  last_consolidated_message_id: string | null;
  last_consolidated_at: number;
  turns_since_last: number;
  updated_at: number;
}

function rowToState(row: ConsolidationStateRowDb): ConsolidationStateRow {
  return {
    threadId: row.thread_id,
    lastConsolidatedMessageId: row.last_consolidated_message_id,
    lastConsolidatedAt: row.last_consolidated_at,
    turnsSinceLast: row.turns_since_last,
    updatedAt: row.updated_at,
  };
}

export function getConsolidationState(threadId: string): ConsolidationStateRow | null {
  if (!threadId) return null;
  ensureFactSchema();
  const row = getMemoryDb().getFirstSync<ConsolidationStateRowDb>(
    `SELECT * FROM memory_consolidation_state WHERE thread_id = ? LIMIT 1`,
    threadId,
  );
  return row ? rowToState(row) : null;
}

export function listDirtyThreadIds(): string[] {
  ensureFactSchema();
  const rows = getMemoryDb().getAllSync<{ thread_id: string }>(
    `SELECT thread_id FROM memory_consolidation_state WHERE turns_since_last > 0`,
  );
  return rows.map((r) => r.thread_id);
}

interface UpsertStateInput {
  threadId: string;
  lastConsolidatedMessageId?: string | null;
  lastConsolidatedAt?: number;
  turnsSinceLast?: number;
  now?: number;
}

function upsertState(input: UpsertStateInput): void {
  ensureFactSchema();
  const db = getMemoryDb();
  const now = input.now ?? Date.now();
  const existing = db.getFirstSync<ConsolidationStateRowDb>(
    `SELECT * FROM memory_consolidation_state WHERE thread_id = ? LIMIT 1`,
    input.threadId,
  );
  const lastConsolidatedMessageId =
    input.lastConsolidatedMessageId !== undefined
      ? input.lastConsolidatedMessageId
      : (existing?.last_consolidated_message_id ?? null);
  const lastConsolidatedAt =
    input.lastConsolidatedAt !== undefined
      ? input.lastConsolidatedAt
      : (existing?.last_consolidated_at ?? 0);
  const turnsSinceLast =
    input.turnsSinceLast !== undefined
      ? input.turnsSinceLast
      : (existing?.turns_since_last ?? 0);
  if (existing) {
    db.runSync(
      `UPDATE memory_consolidation_state
         SET last_consolidated_message_id = ?,
             last_consolidated_at = ?,
             turns_since_last = ?,
             updated_at = ?
         WHERE thread_id = ?`,
      lastConsolidatedMessageId,
      lastConsolidatedAt,
      turnsSinceLast,
      now,
      input.threadId,
    );
  } else {
    db.runSync(
      `INSERT INTO memory_consolidation_state
         (thread_id, last_consolidated_message_id, last_consolidated_at, turns_since_last, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      input.threadId,
      lastConsolidatedMessageId,
      lastConsolidatedAt,
      turnsSinceLast,
      now,
    );
  }
}

export function clearConsolidationState(threadId: string): void {
  if (!threadId) return;
  ensureFactSchema();
  getMemoryDb().runSync(
    `DELETE FROM memory_consolidation_state WHERE thread_id = ?`,
    threadId,
  );
}

// ── Trigger logic ────────────────────────────────────────────────────────

function findIndexById(messages: Message[], id: string | null | undefined): number {
  if (!id) return -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.id === id) return i;
  }
  return -1;
}

function lastAssistantMessage(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isConsolidatableAssistantMessage(messages[i])) return messages[i];
  }
  return undefined;
}

function isConsolidatableAssistantMessage(message: Message | undefined): message is Message {
  if (!message || !isFinalAssistantMessage(message)) return false;
  if (isAssistantFinalResponsePlaceholder(message)) return false;
  const metadata = message.assistantMetadata;
  if (!metadata) return true;
  return metadata.kind === 'final' && metadata.completionStatus === 'complete';
}

function lastUserMessage(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return messages[i];
  }
  return undefined;
}

export interface CountableTurnsInput {
  messages: Message[];
  lastConsolidatedMessageId: string | null;
}

/** Number of `user`/`assistant` turns strictly after the anchor. */
export function countNewTurns(input: CountableTurnsInput): number {
  const idx = findIndexById(input.messages, input.lastConsolidatedMessageId);
  let count = 0;
  for (let i = idx + 1; i < input.messages.length; i += 1) {
    const message = input.messages[i];
    if (message?.role === 'user' || isConsolidatableAssistantMessage(message)) count += 1;
  }
  return count;
}

function unconsolidatedWindow(
  messages: Message[],
  lastConsolidatedMessageId: string | null | undefined,
  anchorMessageId: string | null | undefined,
): Message[] {
  const start = findIndexById(messages, lastConsolidatedMessageId) + 1;
  const anchorIndex = findIndexById(messages, anchorMessageId);
  const end = anchorIndex >= 0 ? anchorIndex + 1 : messages.length;
  return messages.slice(Math.max(start, 0), Math.max(end, start));
}

export interface EvaluateTriggerInput {
  threadId: string;
  messages: Message[];
  now?: number;
  turnThreshold?: number;
  idleThresholdMs?: number;
  appBackgrounded?: boolean;
  state?: ConsolidationStateRow | null;
}

export interface EvaluateTriggerResult {
  shouldRun: boolean;
  reason?: ConsolidationTriggerReason;
  newTurns: number;
  idleMs: number;
  /** Last assistant message id if we should consolidate (anchor for state advance). */
  anchorMessageId?: string;
}

export function evaluateTrigger(input: EvaluateTriggerInput): EvaluateTriggerResult {
  const turnThreshold = input.turnThreshold ?? DEFAULT_TURN_THRESHOLD;
  const idleThresholdMs = input.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
  const now = input.now ?? Date.now();
  const state = input.state ?? getConsolidationState(input.threadId);
  const lastAssistant = lastAssistantMessage(input.messages);

  // Nothing to consolidate without at least one closed assistant turn.
  if (!lastAssistant) {
    return { shouldRun: false, newTurns: 0, idleMs: 0 };
  }

  const newTurns = countNewTurns({
    messages: input.messages,
    lastConsolidatedMessageId: state?.lastConsolidatedMessageId ?? null,
  });

  // No new closed turns at all — nothing to do.
  if (newTurns === 0) {
    return { shouldRun: false, newTurns, idleMs: 0 };
  }

  const lastTurnTimestamp =
    typeof lastAssistant.timestamp === 'number' ? lastAssistant.timestamp : now;
  const idleMs = Math.max(now - lastTurnTimestamp, 0);

  // App-background flush wins: if anything is dirty, consolidate now.
  if (input.appBackgrounded) {
    return {
      shouldRun: true,
      reason: 'app_background',
      newTurns,
      idleMs,
      anchorMessageId: lastAssistant.id,
    };
  }

  if (newTurns >= turnThreshold) {
    return {
      shouldRun: true,
      reason: 'turn_threshold',
      newTurns,
      idleMs,
      anchorMessageId: lastAssistant.id,
    };
  }

  if (idleMs >= idleThresholdMs) {
    return {
      shouldRun: true,
      reason: 'idle_threshold',
      newTurns,
      idleMs,
      anchorMessageId: lastAssistant.id,
    };
  }

  return { shouldRun: false, newTurns, idleMs, anchorMessageId: lastAssistant.id };
}

export interface MarkThreadDirtyInput {
  threadId: string;
  messages: Message[];
  disableLongTermMemory?: boolean;
  now?: number;
}

export interface MarkThreadDirtyResult {
  marked: boolean;
  newTurns: number;
  anchorMessageId?: string;
  skipped?: 'opt_out' | 'no_closed_turn' | 'no_new_turns';
}

export function markThreadDirtyForMemory(
  input: MarkThreadDirtyInput,
): MarkThreadDirtyResult {
  if (input.disableLongTermMemory) {
    return { marked: false, newTurns: 0, skipped: 'opt_out' };
  }
  const evaluation = evaluateTrigger({
    threadId: input.threadId,
    messages: input.messages,
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
  });
  if (!evaluation.anchorMessageId) {
    return { marked: false, newTurns: 0, skipped: 'no_closed_turn' };
  }
  if (evaluation.newTurns === 0) {
    return { marked: false, newTurns: 0, skipped: 'no_new_turns' };
  }
  upsertState({
    threadId: input.threadId,
    turnsSinceLast: evaluation.newTurns,
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
  });
  return {
    marked: true,
    newTurns: evaluation.newTurns,
    anchorMessageId: evaluation.anchorMessageId,
  };
}

// ── Run pipeline ─────────────────────────────────────────────────────────

export interface RunConsolidationInput {
  threadId: string;
  messages: Message[];
  /**
   * When null/undefined, the scheduler is disabled. The scheduler will still ADVANCE the state cursor on
   * `appBackgrounded` flushes? No — it leaves state untouched so that
   * triggers fire as soon as a provider is configured.
   */
  consolidationProvider?: string | null;
  /**
   * Privacy — long-term memory opt-out. When `true` the scheduler is a no-op AND
   * the per-thread dirty cursor is left untouched, so re-enabling the
   * setting later resumes from the same anchor without losing turns.
   */
  disableLongTermMemory?: boolean;
  /** Provided by the caller — the LLM call. Required when `shouldRun`. */
  extractor?: ConsolidatorExtractor;
  /** Optional thread title / persona context to include in the prompt. */
  threadTitle?: string;
  personaSummary?: string;
  now?: number;
  turnThreshold?: number;
  idleThresholdMs?: number;
  appBackgrounded?: boolean;
  /** When true, persist the consolidator output. Defaults to true. */
  persist?: boolean;
}

export interface RunConsolidationResult {
  ran: boolean;
  reason?: ConsolidationTriggerReason;
  newTurns: number;
  idleMs: number;
  result?: ConsolidatorResult;
  /** Why the run was skipped (when `ran === false`). */
  skipped?:
    | 'no_provider'
    | 'no_extractor'
    | 'no_trigger'
    | 'no_user_message'
    | 'extractor_threw'
    | 'opt_out';
}

/**
 * Evaluate the trigger and, if appropriate, run a single consolidation pass
 * for the supplied thread. Updates the scheduler state on success.
 */
export async function maybeRunConsolidation(
  input: RunConsolidationInput,
): Promise<RunConsolidationResult> {
  if (input.disableLongTermMemory) {
    return { ran: false, skipped: 'opt_out', newTurns: 0, idleMs: 0 };
  }
  const provider = (input.consolidationProvider ?? '').trim();
  const state = getConsolidationState(input.threadId);
  const evaluation = evaluateTrigger({
    threadId: input.threadId,
    messages: input.messages,
    state,
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
    ...(typeof input.turnThreshold === 'number' ? { turnThreshold: input.turnThreshold } : {}),
    ...(typeof input.idleThresholdMs === 'number'
      ? { idleThresholdMs: input.idleThresholdMs }
      : {}),
    ...(typeof input.appBackgrounded === 'boolean'
      ? { appBackgrounded: input.appBackgrounded }
      : {}),
  });

  // Always keep the dirty-turn counter fresh so app-background flushes can
  // still fire later when a provider is finally configured.
  if (evaluation.newTurns > 0) {
    upsertState({
      threadId: input.threadId,
      turnsSinceLast: evaluation.newTurns,
      ...(typeof input.now === 'number' ? { now: input.now } : {}),
    });
  }

  if (!provider) {
    return {
      ran: false,
      skipped: 'no_provider',
      newTurns: evaluation.newTurns,
      idleMs: evaluation.idleMs,
    };
  }

  if (!evaluation.shouldRun) {
    return {
      ran: false,
      skipped: 'no_trigger',
      newTurns: evaluation.newTurns,
      idleMs: evaluation.idleMs,
    };
  }

  if (!input.extractor) {
    return {
      ran: false,
      skipped: 'no_extractor',
      newTurns: evaluation.newTurns,
      idleMs: evaluation.idleMs,
    };
  }

  const lastAssistant = lastAssistantMessage(input.messages);
  const lastUser = lastUserMessage(input.messages);
  if (!lastAssistant || !lastUser) {
    return {
      ran: false,
      skipped: 'no_user_message',
      newTurns: evaluation.newTurns,
      idleMs: evaluation.idleMs,
    };
  }

  const messageWindow = unconsolidatedWindow(
    input.messages,
    state?.lastConsolidatedMessageId ?? null,
    evaluation.anchorMessageId ?? lastAssistant.id,
  );

  const turnInput: ConsolidatorTurnInput = {
    userMessage: lastUser.content ?? '',
    assistantMessage: lastAssistant.content ?? '',
    conversationId: input.threadId,
    threadId: input.threadId,
    sourceUserMessageId: lastUser.id,
    sourceAssistantMessageId: lastAssistant.id,
    messages: messageWindow,
    ...(input.threadTitle ? { threadTitle: input.threadTitle } : {}),
    ...(input.personaSummary ? { personaSummary: input.personaSummary } : {}),
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
  };

  const opts: ConsolidatorOptions = {
    extractor: input.extractor,
    persist: input.persist !== false,
    ...(typeof input.now === 'number' ? { now: () => input.now! } : {}),
  };

  let result: ConsolidatorResult;
  try {
    result = await consolidateTurn(turnInput, opts);
  } catch (error) {
    logger.devWarn(
      'consolidatorScheduler.consolidateTurn threw (should not happen):',
      error instanceof Error ? error.message : String(error),
    );
    return {
      ran: false,
      skipped: 'extractor_threw',
      newTurns: evaluation.newTurns,
      idleMs: evaluation.idleMs,
    };
  }

  // Advance the cursor — even if the model returned an empty result we still
  // anchor at this assistant turn so we don't keep retrying it on every call.
  upsertState({
    threadId: input.threadId,
    lastConsolidatedMessageId: evaluation.anchorMessageId ?? lastAssistant.id,
    lastConsolidatedAt: input.now ?? Date.now(),
    turnsSinceLast: 0,
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
  });

  return {
    ran: true,
    ...(evaluation.reason ? { reason: evaluation.reason } : {}),
    newTurns: evaluation.newTurns,
    idleMs: evaluation.idleMs,
    result,
  };
}

// ── App-background fan-out ──────────────────────────────────────────────

export interface FlushAllInput {
  /** Reader yielding the live transcript for a thread. */
  loadMessages: (threadId: string) => Message[] | Promise<Message[]>;
  consolidationProvider?: string | null;
  disableLongTermMemory?: boolean;
  extractor?: ConsolidatorExtractor;
  now?: number;
  turnThreshold?: number;
  idleThresholdMs?: number;
}

export interface FlushAllResult {
  attempted: number;
  ran: number;
  skipped: number;
  errors: number;
}

/**
 * Iterate every thread with `turns_since_last > 0` and force-consolidate it
 * via the `app_background` trigger. Safe to call from an `AppState` change
 * handler. Returns counters for telemetry.
 */
export async function flushAllDirtyThreads(
  input: FlushAllInput,
): Promise<FlushAllResult> {
  const counters: FlushAllResult = { attempted: 0, ran: 0, skipped: 0, errors: 0 };
  if (input.disableLongTermMemory) {
    return counters;
  }
  const provider = (input.consolidationProvider ?? '').trim();
  if (!provider || !input.extractor) {
    return counters;
  }

  let dirty: string[] = [];
  try {
    dirty = listDirtyThreadIds();
  } catch (error) {
    logger.devWarn(
      'flushAllDirtyThreads: listDirtyThreadIds failed:',
      error instanceof Error ? error.message : String(error),
    );
    return counters;
  }

  for (const threadId of dirty) {
    counters.attempted += 1;
    try {
      const messages = await input.loadMessages(threadId);
      if (!Array.isArray(messages) || messages.length === 0) {
        counters.skipped += 1;
        continue;
      }
      const outcome = await maybeRunConsolidation({
        threadId,
        messages,
        consolidationProvider: provider,
        extractor: input.extractor,
        appBackgrounded: true,
        ...(typeof input.now === 'number' ? { now: input.now } : {}),
        ...(typeof input.turnThreshold === 'number'
          ? { turnThreshold: input.turnThreshold }
          : {}),
        ...(typeof input.idleThresholdMs === 'number'
          ? { idleThresholdMs: input.idleThresholdMs }
          : {}),
      });
      if (outcome.ran) counters.ran += 1;
      else counters.skipped += 1;
    } catch (error) {
      counters.errors += 1;
      logger.devWarn(
        `flushAllDirtyThreads: thread ${threadId} failed:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return counters;
}
