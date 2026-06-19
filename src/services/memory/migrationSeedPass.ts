// ---------------------------------------------------------------------------
// Kavi — Migration consolidation seed pass
// ---------------------------------------------------------------------------
// After the v6→v7 single-thread collapse migration runs, every prior
// conversation that was flagged `archivedFromMigration: true` is preserved
// verbatim in the conversation store but does not yet contribute to the
// new `memory_facts` / `memory_blocks` store. This module walks each
// archived conversation, pairs adjacent (user → assistant) turns, and feeds
// them into the existing `consolidateTurn` pipeline so that long-lived
// information surfaces in the unified memory.
//
// Design rules:
//   • Resumable — per-conversation cursor in `memory_migration_state`.
//   • Throttled — process at most `maxTurnsPerCall` turn pairs per call so
//     app launch never blocks on a large backlog.
//   • Opt-out — when `disableLongTermMemory` is on, the runner does nothing.
//   • Fail-safe — extractor failures mark the conversation `error` but do
//     not throw out of the caller. Re-running clears the error if the
//     extractor next call succeeds.
//   • Idempotent — `consolidateTurn` already dedupes facts by content_hash;
//     re-seeding produces zero new facts.
// ---------------------------------------------------------------------------

import { getMany, getOne, runMemoryStatement } from './access/crud';
import { ensureFactSchema } from './schema';
import {
  applyConsolidatorResult,
  buildConsolidatorPrompt,
  parseConsolidatorOutput,
  type ConsolidatorExtractor,
  type ConsolidatorResult,
} from './consolidator';
import type { Conversation } from '../../types/conversation';
import type { Message } from '../../types/message';
import { createLogger } from '../../utils/logger';

const logger = createLogger('memory.migrationSeedPass');

export type MigrationStatus = 'pending' | 'in_progress' | 'completed' | 'error';

export interface MigrationStateRow {
  conversationId: string;
  lastSeededMessageId: string | null;
  seededTurns: number;
  status: MigrationStatus;
  error: string | null;
  updatedAt: number;
}

interface MigrationStateRowDb {
  conversation_id: string;
  last_seeded_message_id: string | null;
  seeded_turns: number;
  status: string;
  error: string | null;
  updated_at: number;
}

export const DEFAULT_MAX_TURNS_PER_CALL = 4;
export const DEFAULT_MAX_CONVERSATIONS_PER_CALL = 8;

// ── State CRUD ──────────────────────────────────────────────────────────────

function rowToState(row: MigrationStateRowDb): MigrationStateRow {
  return {
    conversationId: row.conversation_id,
    lastSeededMessageId: row.last_seeded_message_id,
    seededTurns: row.seeded_turns,
    status: (row.status as MigrationStatus) ?? 'pending',
    error: row.error,
    updatedAt: row.updated_at,
  };
}

export function getMigrationState(conversationId: string): MigrationStateRow | null {
  const row = getOne<MigrationStateRowDb>(
    `SELECT * FROM memory_migration_state WHERE conversation_id = ? LIMIT 1`,
    conversationId,
  );
  return row ? rowToState(row) : null;
}

export function listMigrationStates(): MigrationStateRow[] {
  const rows = getMany<MigrationStateRowDb>(
    `SELECT * FROM memory_migration_state ORDER BY updated_at DESC`,
  );
  return rows.map(rowToState);
}

interface UpsertInput {
  conversationId: string;
  lastSeededMessageId: string | null;
  seededTurns: number;
  status: MigrationStatus;
  error: string | null;
  now: number;
}

function upsertMigrationState(input: UpsertInput): void {
  runMemoryStatement(
    `INSERT INTO memory_migration_state (
       conversation_id, last_seeded_message_id, seeded_turns, status, error, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
       last_seeded_message_id = excluded.last_seeded_message_id,
       seeded_turns = excluded.seeded_turns,
       status = excluded.status,
       error = excluded.error,
       updated_at = excluded.updated_at`,
    input.conversationId,
    input.lastSeededMessageId,
    input.seededTurns,
    input.status,
    input.error,
    input.now,
  );
}

export function clearMigrationState(conversationId: string): void {
  runMemoryStatement(
    `DELETE FROM memory_migration_state WHERE conversation_id = ?`,
    conversationId,
  );
}

// ── Turn extraction ─────────────────────────────────────────────────────────

/** Adjacent (user → assistant) turn pair from a conversation. */
export interface SeedTurn {
  userMessage: Message;
  assistantMessage: Message;
}

/**
 * Walk a conversation's messages and yield user→assistant turn pairs strictly
 * after the given anchor message id. Only adjacent pairs count — orphan user
 * messages without a following assistant reply are skipped.
 */
export function extractSeedTurns(
  messages: ReadonlyArray<Message>,
  anchorMessageId: string | null,
): SeedTurn[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  let cursor = 0;
  if (anchorMessageId) {
    const anchorIdx = messages.findIndex((m) => m.id === anchorMessageId);
    if (anchorIdx >= 0) cursor = anchorIdx + 1;
  }
  const out: SeedTurn[] = [];
  let pendingUser: Message | null = null;
  for (let i = cursor; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.role === 'user') {
      pendingUser = m;
      continue;
    }
    if (m.role === 'assistant' && pendingUser) {
      const text = (m.content ?? '').toString().trim();
      const userText = (pendingUser.content ?? '').toString().trim();
      if (text.length > 0 && userText.length > 0) {
        out.push({ userMessage: pendingUser, assistantMessage: m });
      }
      pendingUser = null;
    }
    // tool / system messages — ignore for seeding.
  }
  return out;
}

// ── Per-conversation seeder ─────────────────────────────────────────────────

export interface SeedConversationInput {
  conversation: Pick<Conversation, 'id' | 'title' | 'messages'>;
  extractor: ConsolidatorExtractor;
  /** When true, do not record consolidated results — return parsed payloads only. */
  dryRun?: boolean;
  maxTurnsPerCall?: number;
  now?: number;
}

export interface SeedConversationResult {
  conversationId: string;
  seededTurns: number;
  remainingTurns: number;
  status: MigrationStatus;
  results: ConsolidatorResult[];
  error?: string;
}

export async function seedConversation(
  input: SeedConversationInput,
): Promise<SeedConversationResult> {
  ensureFactSchema();
  const conv = input.conversation;
  if (!conv?.id) {
    return {
      conversationId: '',
      seededTurns: 0,
      remainingTurns: 0,
      status: 'error',
      results: [],
      error: 'invalid_conversation',
    };
  }
  const now = input.now ?? Date.now();
  const cap = Math.max(1, input.maxTurnsPerCall ?? DEFAULT_MAX_TURNS_PER_CALL);

  const existing = getMigrationState(conv.id);
  if (existing?.status === 'completed') {
    return {
      conversationId: conv.id,
      seededTurns: 0,
      remainingTurns: 0,
      status: 'completed',
      results: [],
    };
  }

  const turns = extractSeedTurns(conv.messages ?? [], existing?.lastSeededMessageId ?? null);
  if (turns.length === 0) {
    upsertMigrationState({
      conversationId: conv.id,
      lastSeededMessageId: existing?.lastSeededMessageId ?? null,
      seededTurns: existing?.seededTurns ?? 0,
      status: 'completed',
      error: null,
      now,
    });
    return {
      conversationId: conv.id,
      seededTurns: 0,
      remainingTurns: 0,
      status: 'completed',
      results: [],
    };
  }

  // Mark in-progress so concurrent passes can short-circuit if needed.
  upsertMigrationState({
    conversationId: conv.id,
    lastSeededMessageId: existing?.lastSeededMessageId ?? null,
    seededTurns: existing?.seededTurns ?? 0,
    status: 'in_progress',
    error: null,
    now,
  });

  const slice = turns.slice(0, cap);
  const results: ConsolidatorResult[] = [];
  let lastSeededMessageId: string | null = existing?.lastSeededMessageId ?? null;
  let seededTurns = existing?.seededTurns ?? 0;

  for (const turn of slice) {
    try {
      const prompt = buildConsolidatorPrompt({
        userMessage: turn.userMessage.content?.toString() ?? '',
        assistantMessage: turn.assistantMessage.content?.toString() ?? '',
        threadTitle: conv.title,
        now: turn.assistantMessage.timestamp ?? now,
      });
      const raw = await input.extractor(prompt);
      const result = parseConsolidatorOutput(raw);
      if (input.dryRun !== true) {
        applyConsolidatorResult(result, {
          now: turn.assistantMessage.timestamp ?? now,
          threadTitle: conv.title,
        });
      }
      results.push(result);
      lastSeededMessageId = turn.assistantMessage.id;
      seededTurns += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      logger.warn?.(`seed extractor threw for conv ${conv.id}: ${message}`);
      upsertMigrationState({
        conversationId: conv.id,
        lastSeededMessageId,
        seededTurns,
        status: 'error',
        error: message,
        now,
      });
      return {
        conversationId: conv.id,
        seededTurns: seededTurns - (existing?.seededTurns ?? 0),
        remainingTurns: turns.length - results.length,
        status: 'error',
        results,
        error: message,
      };
    }
  }

  const remaining = turns.length - slice.length;
  const status: MigrationStatus = remaining === 0 ? 'completed' : 'in_progress';
  upsertMigrationState({
    conversationId: conv.id,
    lastSeededMessageId,
    seededTurns,
    status,
    error: null,
    now,
  });
  return {
    conversationId: conv.id,
    seededTurns: slice.length,
    remainingTurns: remaining,
    status,
    results,
  };
}

// ── Multi-conversation runner ───────────────────────────────────────────────

export interface RunSeedPassInput {
  /** All known conversations (including non-archived). The runner filters. */
  conversations: ReadonlyArray<Conversation>;
  extractor: ConsolidatorExtractor | null | undefined;
  disableLongTermMemory?: boolean;
  /** Throttle: max conversations to touch in one call. */
  maxConversationsPerCall?: number;
  /** Throttle: max turn pairs to seed per conversation in one call. */
  maxTurnsPerCall?: number;
  now?: number;
}

export interface RunSeedPassResult {
  attempted: number;
  completed: number;
  inProgress: number;
  errors: number;
  skipped: number;
  remainingConversations: number;
  /** Conversations that still have unseeded turn pairs after this call. */
  pending: string[];
}

const ZERO_RESULT: RunSeedPassResult = {
  attempted: 0,
  completed: 0,
  inProgress: 0,
  errors: 0,
  skipped: 0,
  remainingConversations: 0,
  pending: [],
};

/**
 * Walk archived conversations and seed each one in throttled batches.
 * Returns counters describing this call's progress; safe to call repeatedly
 * (e.g. on each app foreground) until `remainingConversations === 0`.
 */
export async function runMigrationSeedPass(input: RunSeedPassInput): Promise<RunSeedPassResult> {
  if (input.disableLongTermMemory) {
    return { ...ZERO_RESULT, skipped: countArchivedPending(input.conversations) };
  }
  if (typeof input.extractor !== 'function') {
    return { ...ZERO_RESULT, skipped: countArchivedPending(input.conversations) };
  }
  ensureFactSchema();

  const archived = (input.conversations ?? []).filter((c) => c.archivedFromMigration);
  if (archived.length === 0) {
    return { ...ZERO_RESULT };
  }

  const cap = Math.max(1, input.maxConversationsPerCall ?? DEFAULT_MAX_CONVERSATIONS_PER_CALL);
  const counters: RunSeedPassResult = {
    attempted: 0,
    completed: 0,
    inProgress: 0,
    errors: 0,
    skipped: 0,
    remainingConversations: 0,
    pending: [],
  };

  // Sort: oldest-first so we process the longest-aged archives before recent
  // imports. Stable across calls for resumability.
  const sorted = [...archived].sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));

  for (const conv of sorted) {
    const state = getMigrationState(conv.id);
    if (state?.status === 'completed') {
      counters.skipped += 1;
      continue;
    }
    if (counters.attempted >= cap) {
      counters.pending.push(conv.id);
      counters.remainingConversations += 1;
      continue;
    }
    counters.attempted += 1;
    const result = await seedConversation({
      conversation: conv,
      extractor: input.extractor,
      maxTurnsPerCall: input.maxTurnsPerCall,
      now: input.now,
    });
    if (result.status === 'completed') counters.completed += 1;
    else if (result.status === 'error') counters.errors += 1;
    else counters.inProgress += 1;
    if (result.remainingTurns > 0) {
      counters.pending.push(conv.id);
      counters.remainingConversations += 1;
    }
  }

  return counters;
}

function countArchivedPending(conversations: ReadonlyArray<Conversation>): number {
  let n = 0;
  for (const c of conversations ?? []) {
    if (!c.archivedFromMigration) continue;
    try {
      const state = getMigrationState(c.id);
      if (state?.status !== 'completed') n += 1;
    } catch {
      // SQLite unavailable — count as pending so callers know work remains.
      n += 1;
    }
  }
  return n;
}
