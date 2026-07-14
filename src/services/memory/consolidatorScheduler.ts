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
//   • When no extractor is supplied, resolves the active cascade path from
//     `resolveConsolidationPath()` (same as the ingestion queue).
//   • Structural-only consolidation still runs when enrichment mode is `off`.
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

import type { Message } from '../../types/message';
import { createLogger } from '../../utils/logger';
import { resolveConsolidationExtractor } from './consolidation/turnPipeline';
import { runConsolidation } from './consolidation/orchestrator';
import {
  evaluateTrigger,
  lastAssistantMessage,
  lastUserMessage,
  unconsolidatedWindow,
  type ConsolidationTriggerReason,
} from './consolidation/schedulerEvaluation';
import { advanceConsolidationCursorPastExcludedPublications } from './consolidation/publicationExclusion';
import {
  getConsolidationState,
  listDirtyThreadIds,
  upsertState,
} from './consolidation/schedulerState';
import { type ConsolidatorExtractor } from './consolidator';
import {
  resolveCodeOwnedMemoryConversationId,
  resolveCodeOwnedMemoryPersonaId,
} from './memoryScopeIdentity';
import type { TurnProviderOutcome } from './turnProcessor';

const logger = createLogger('memory.consolidatorScheduler');

export {
  DEFAULT_IDLE_THRESHOLD_MS,
  DEFAULT_TURN_THRESHOLD,
  countNewTurns,
  evaluateTrigger,
  type CountableTurnsInput,
  type EvaluateTriggerInput,
  type EvaluateTriggerResult,
} from './consolidation/schedulerEvaluation';
export {
  clearConsolidationState,
  getConsolidationState,
  listDirtyThreadIds,
  upsertState,
  type ConsolidationStateRow,
  type UpsertStateInput,
} from './consolidation/schedulerState';

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

export function markThreadDirtyForMemory(input: MarkThreadDirtyInput): MarkThreadDirtyResult {
  advanceConsolidationCursorPastExcludedPublications({
    threadId: input.threadId,
    messages: input.messages,
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
  });
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
  memoryConversationId?: string;
  messages: Message[];
  /**
   * When null/undefined, the scheduler is disabled. The scheduler will still ADVANCE the state cursor on
   * `appBackgrounded` flushes? No — it leaves state untouched so that
   * triggers fire as soon as a provider is configured.
   */
  consolidationProvider?: string | null;
  /**
   * Privacy — long-term memory opt-out. When `true` the scheduler is a no-op AND
   * terminal opt-out receipts advance the exclusion cursor. Re-enabling starts
   * strictly after excluded turns.
   */
  disableLongTermMemory?: boolean;
  /** Provided by the caller — the LLM call. Required when `shouldRun`. */
  extractor?: ConsolidatorExtractor;
  /** Optional thread title / persona context to include in the prompt. */
  threadTitle?: string;
  personaSummary?: string;
  personaId?: string | null;
  now?: number;
  turnThreshold?: number;
  idleThresholdMs?: number;
  appBackgrounded?: boolean;
}

export interface RunConsolidationResult {
  ran: boolean;
  reason?: ConsolidationTriggerReason;
  newTurns: number;
  idleMs: number;
  providerOutcome?: TurnProviderOutcome;
  /** Why the run was skipped (when `ran === false`). */
  skipped?:
    | 'no_provider'
    | 'no_extractor'
    | 'no_trigger'
    | 'no_user_message'
    | 'enrichment_retryable'
    | 'processing_failed'
    | 'opt_out';
}

/**
 * Evaluate the trigger and, if appropriate, run a single consolidation pass
 * for the supplied thread. Updates the scheduler state on success.
 */
export async function maybeRunConsolidation(
  input: RunConsolidationInput,
): Promise<RunConsolidationResult> {
  advanceConsolidationCursorPastExcludedPublications({
    threadId: input.threadId,
    messages: input.messages,
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
  });
  if (input.disableLongTermMemory) {
    return { ran: false, skipped: 'opt_out', newTurns: 0, idleMs: 0 };
  }
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

  if (!evaluation.shouldRun) {
    return {
      ran: false,
      skipped: 'no_trigger',
      newTurns: evaluation.newTurns,
      idleMs: evaluation.idleMs,
    };
  }

  const lastAssistant = lastAssistantMessage(input.messages);
  const lastUser = lastUserMessage(input.messages);
  const sourceEndMessageId = evaluation.anchorMessageId;
  if (!lastAssistant || !lastUser || !sourceEndMessageId) {
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
    sourceEndMessageId,
  );

  let extractor = input.extractor;
  if (!extractor) {
    extractor = await resolveConsolidationExtractor();
  }

  const memoryConversationId = resolveCodeOwnedMemoryConversationId(
    input.memoryConversationId,
    input.threadId,
  );
  let ingestionResult: Awaited<ReturnType<typeof runConsolidation>>;
  try {
    ingestionResult = await runConsolidation({
      threadId: input.threadId,
      memoryConversationId,
      messages: messageWindow,
      sourceEndMessageId,
      threadTitle: input.threadTitle,
      personaSummary: input.personaSummary,
      episodeAccess: {
        personaId: resolveCodeOwnedMemoryPersonaId(input.personaId),
        shareability: 'thread_only',
      },
      now: input.now,
      extractor: extractor ?? null,
    });
  } catch {
    logger.devWarn('consolidatorScheduler processing failed');
    return {
      ran: false,
      skipped: 'processing_failed',
      newTurns: evaluation.newTurns,
      idleMs: evaluation.idleMs,
    };
  }
  if (!ingestionResult.processed) {
    return {
      ran: false,
      skipped: 'no_extractor',
      newTurns: evaluation.newTurns,
      idleMs: evaluation.idleMs,
      providerOutcome: ingestionResult.providerOutcome,
    };
  }
  if (
    ingestionResult.providerOutcome.status === 'malformed' ||
    ingestionResult.providerOutcome.status === 'schema_invalid' ||
    ingestionResult.providerOutcome.status === 'provider_error'
  ) {
    return {
      ran: false,
      skipped: 'enrichment_retryable',
      newTurns: evaluation.newTurns,
      idleMs: evaluation.idleMs,
      providerOutcome: ingestionResult.providerOutcome,
    };
  }

  return {
    ran: true,
    ...(evaluation.reason ? { reason: evaluation.reason } : {}),
    newTurns: evaluation.newTurns,
    idleMs: evaluation.idleMs,
    providerOutcome: ingestionResult.providerOutcome,
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
export async function flushAllDirtyThreads(input: FlushAllInput): Promise<FlushAllResult> {
  const counters: FlushAllResult = { attempted: 0, ran: 0, skipped: 0, errors: 0 };
  if (input.disableLongTermMemory) {
    return counters;
  }

  const resolvedExtractor = input.extractor ?? (await resolveConsolidationExtractor());

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
        consolidationProvider: input.consolidationProvider,
        extractor: resolvedExtractor,
        appBackgrounded: true,
        ...(typeof input.now === 'number' ? { now: input.now } : {}),
        ...(typeof input.turnThreshold === 'number' ? { turnThreshold: input.turnThreshold } : {}),
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
