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
import {
  getConsolidationState,
  listDirtyThreadIds,
  upsertState,
} from './consolidation/schedulerState';
import {
  consolidateTurn,
  type ConsolidatorExtractor,
  type ConsolidatorOptions,
  type ConsolidatorResult,
  type ConsolidatorTurnInput,
} from './consolidator';

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

  let extractor = input.extractor;
  if (!extractor) {
    extractor = await resolveConsolidationExtractor();
  }

  if (!extractor) {
    const ingestionResult = await runConsolidation({
      threadId: input.threadId,
      messages: input.messages,
      threadTitle: input.threadTitle,
      personaSummary: input.personaSummary,
      now: input.now,
      extractor: null,
      skipWorkingMemorySync: true,
    });
    if (!ingestionResult.processed) {
      return {
        ran: false,
        skipped: 'no_extractor',
        newTurns: evaluation.newTurns,
        idleMs: evaluation.idleMs,
      };
    }

    return {
      ran: true,
      ...(evaluation.reason ? { reason: evaluation.reason } : {}),
      newTurns: evaluation.newTurns,
      idleMs: evaluation.idleMs,
      result: {
        episodeSummary: null,
        newFacts: [],
        invalidatedFacts: [],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
    };
  }

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
    extractor,
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
