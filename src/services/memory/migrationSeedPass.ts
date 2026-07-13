// ---------------------------------------------------------------------------
// Kavi — Migration consolidation seed pass
// ---------------------------------------------------------------------------
// After the v6→v7 single-thread collapse migration runs, every prior
// conversation that was flagged `archivedFromMigration: true` is preserved
// verbatim in the conversation store but does not yet contribute to the
// structured memory store. This module walks each
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
//   • Idempotent — each seeded fact position has a stable source-bound
//     contribution identity and completed conversations are not re-extracted.
// ---------------------------------------------------------------------------

import { runMemoryStatement } from './access/crud';
import { ensureFactSchema, newId } from './schema';
import {
  applyConsolidatorResult,
  consolidateTurn,
  type ConsolidatorExtractor,
  type ConsolidatorResult,
} from './consolidator';
import { type MigrationErrorCode, type MigrationStatus } from './migrationStateSchema';
import type { Conversation } from '../../types/conversation';
import type { Message } from '../../types/message';
import { createLogger } from '../../utils/logger';
import { canWriteLongTermMemory, getMemoryPolicyEpoch, isMemoryPolicyEpochCurrent } from './policy';
import {
  checkpointMigrationTurn,
  getMigrationState,
  MIGRATION_CLAIM_LEASE_MS,
  type MigrationStateRow,
} from './migrationStateStore';
import { resolveCodeOwnedMemoryPersonaId } from './memoryScopeIdentity';
import { CONSOLIDATION_FACT_PRODUCER_IDS } from './consolidation/factContributionIdentity';

const logger = createLogger('memory.migrationSeedPass');

export const DEFAULT_MAX_TURNS_PER_CALL = 4;
export const DEFAULT_MAX_CONVERSATIONS_PER_CALL = 8;

// ── State CRUD ──────────────────────────────────────────────────────────────

const MIGRATION_CLAIM_HEARTBEAT_MS = 60_000;

interface AcquiredMigrationClaim {
  outcome: 'acquired';
  token: string;
  state: MigrationStateRow;
}

interface BusyMigrationClaim {
  outcome: 'busy';
  state: MigrationStateRow;
}

interface CompletedMigrationClaim {
  outcome: 'completed';
  state: MigrationStateRow;
}

type MigrationClaim = AcquiredMigrationClaim | BusyMigrationClaim | CompletedMigrationClaim;

function claimMigrationState(conversationId: string, now: number): MigrationClaim {
  runMemoryStatement(
    `INSERT OR IGNORE INTO memory_migration_state (
       conversation_id, last_seeded_message_id, seeded_turns, status, error,
       claim_token, claim_expires_at, updated_at
     ) VALUES (?, NULL, 0, 'pending', NULL, NULL, NULL, ?)`,
    conversationId,
    now,
  );

  const token = newId('migration_claim');
  const claimed = runMemoryStatement(
    `UPDATE memory_migration_state
        SET status = 'in_progress',
            error = NULL,
            claim_token = ?,
            claim_expires_at = ?,
            updated_at = ?
      WHERE conversation_id = ?
        AND status != 'completed'
        AND (
          claim_token IS NULL
          OR claim_expires_at IS NULL
          OR claim_expires_at <= ?
        )`,
    token,
    now + MIGRATION_CLAIM_LEASE_MS,
    now,
    conversationId,
    now,
  );
  const state = getMigrationState(conversationId);
  if (!state) {
    throw new Error('Migration claim state was not persisted');
  }
  if (claimed.changes === 1) {
    return { outcome: 'acquired', token, state };
  }
  return { outcome: state.status === 'completed' ? 'completed' : 'busy', state };
}

function renewMigrationClaim(conversationId: string, token: string, now: number): boolean {
  const renewed = runMemoryStatement(
    `UPDATE memory_migration_state
        SET claim_expires_at = ?, updated_at = ?
      WHERE conversation_id = ?
        AND claim_token = ?
        AND status = 'in_progress'`,
    now + MIGRATION_CLAIM_LEASE_MS,
    now,
    conversationId,
    token,
  );
  return renewed.changes === 1;
}

interface FinalizeMigrationClaimInput {
  conversationId: string;
  token: string;
  lastSeededMessageId: string | null;
  seededTurns: number;
  status: MigrationStatus;
  error: MigrationErrorCode | null;
  now: number;
}

function finalizeMigrationClaim(input: FinalizeMigrationClaimInput): boolean {
  const finalized = runMemoryStatement(
    `UPDATE memory_migration_state
        SET last_seeded_message_id = ?,
            seeded_turns = ?,
            status = ?,
            error = ?,
            claim_token = NULL,
            claim_expires_at = NULL,
            updated_at = ?
      WHERE conversation_id = ?
        AND claim_token = ?`,
    input.lastSeededMessageId,
    input.seededTurns,
    input.status,
    input.error,
    input.now,
    input.conversationId,
    input.token,
  );
  return finalized.changes === 1;
}

function cancelMigrationClaim(conversationId: string, token: string, now: number): boolean {
  const cancelled = runMemoryStatement(
    `UPDATE memory_migration_state
        SET status = 'pending',
            error = NULL,
            claim_token = NULL,
            claim_expires_at = NULL,
            updated_at = ?
      WHERE conversation_id = ?
        AND claim_token = ?
        AND status = 'in_progress'`,
    now,
    conversationId,
    token,
  );
  return cancelled.changes === 1;
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
  conversation: Pick<Conversation, 'id' | 'title' | 'messages' | 'personaId'>;
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
  claimOutcome: 'acquired' | 'busy' | 'not_required' | 'cancelled';
  results: ConsolidatorResult[];
  error?: MigrationErrorCode;
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
      claimOutcome: 'not_required',
      results: [],
      error: 'invalid_conversation',
    };
  }
  if (!canWriteLongTermMemory()) {
    return {
      conversationId: conv.id,
      seededTurns: 0,
      remainingTurns: extractSeedTurns(conv.messages ?? [], null).length,
      status: 'pending',
      claimOutcome: 'cancelled',
      results: [],
    };
  }
  const policyEpoch = getMemoryPolicyEpoch();
  const now = input.now ?? Date.now();
  const cap = Math.max(1, input.maxTurnsPerCall ?? DEFAULT_MAX_TURNS_PER_CALL);

  const existing = getMigrationState(conv.id);
  if (existing?.status === 'completed') {
    return {
      conversationId: conv.id,
      seededTurns: 0,
      remainingTurns: 0,
      status: 'completed',
      claimOutcome: 'not_required',
      results: [],
    };
  }

  const claim = claimMigrationState(conv.id, now);
  if (claim.outcome === 'completed') {
    return {
      conversationId: conv.id,
      seededTurns: 0,
      remainingTurns: 0,
      status: 'completed',
      claimOutcome: 'not_required',
      results: [],
    };
  }
  const turns = extractSeedTurns(conv.messages ?? [], claim.state.lastSeededMessageId ?? null);
  if (claim.outcome === 'busy') {
    return {
      conversationId: conv.id,
      seededTurns: 0,
      remainingTurns: turns.length,
      status: 'in_progress',
      claimOutcome: 'busy',
      results: [],
    };
  }

  const heartbeat =
    input.now === undefined
      ? setInterval(() => {
          try {
            renewMigrationClaim(conv.id, claim.token, Date.now());
          } catch {
            // The fenced state transition below remains the source of truth.
          }
        }, MIGRATION_CLAIM_HEARTBEAT_MS)
      : null;
  try {
    return await seedClaimedConversation({
      input,
      claim,
      turns,
      now,
      cap,
      policyEpoch,
    });
  } finally {
    if (heartbeat !== null) clearInterval(heartbeat);
  }
}

interface SeedClaimedConversationInput {
  input: SeedConversationInput;
  claim: AcquiredMigrationClaim;
  turns: SeedTurn[];
  now: number;
  cap: number;
  policyEpoch: number;
}

async function seedClaimedConversation(
  claimed: SeedClaimedConversationInput,
): Promise<SeedConversationResult> {
  const { input, claim, turns, now, cap, policyEpoch } = claimed;
  const conv = input.conversation;
  const startingSeededTurns = claim.state.seededTurns;
  let lastSeededMessageId = claim.state.lastSeededMessageId;
  let seededTurns = startingSeededTurns;
  const results: ConsolidatorResult[] = [];

  const cancelForPolicy = (): SeedConversationResult => {
    cancelMigrationClaim(conv.id, claim.token, input.now ?? Date.now());
    return {
      conversationId: conv.id,
      seededTurns: seededTurns - startingSeededTurns,
      remainingTurns: turns.length - results.length,
      status: 'pending',
      claimOutcome: 'cancelled',
      results,
    };
  };

  if (!isMemoryPolicyEpochCurrent(policyEpoch)) {
    return cancelForPolicy();
  }

  if (turns.length === 0) {
    const finalized = finalizeMigrationClaim({
      conversationId: conv.id,
      token: claim.token,
      lastSeededMessageId,
      seededTurns,
      status: 'completed',
      error: null,
      now: input.now ?? Date.now(),
    });
    return finalized
      ? {
          conversationId: conv.id,
          seededTurns: 0,
          remainingTurns: 0,
          status: 'completed',
          claimOutcome: 'acquired',
          results,
        }
      : claimLostResult(conv.id, 0, 0, results);
  }

  const slice = turns.slice(0, cap);
  for (const turn of slice) {
    if (!isMemoryPolicyEpochCurrent(policyEpoch)) {
      return cancelForPolicy();
    }
    const leaseNow = input.now ?? Date.now();
    if (!renewMigrationClaim(conv.id, claim.token, leaseNow)) {
      return claimLostResult(
        conv.id,
        seededTurns - startingSeededTurns,
        turns.length - results.length,
        results,
      );
    }
    try {
      const turnNow = turn.assistantMessage.timestamp ?? now;
      const outcome = await consolidateTurn(
        {
          userMessage: turn.userMessage.content?.toString() ?? '',
          assistantMessage: turn.assistantMessage.content?.toString() ?? '',
          threadTitle: conv.title,
          sourceUserMessageId: turn.userMessage.id,
          sourceAssistantMessageId: turn.assistantMessage.id,
          messages: [turn.userMessage, turn.assistantMessage],
          now: turnNow,
        },
        {
          extractor: input.extractor,
        },
      );
      if (!isMemoryPolicyEpochCurrent(policyEpoch)) {
        return cancelForPolicy();
      }
      if (outcome.status !== 'valid' && outcome.status !== 'empty_valid') {
        const code: MigrationErrorCode = outcome.code;
        const finalized = finalizeMigrationClaim({
          conversationId: conv.id,
          token: claim.token,
          lastSeededMessageId,
          seededTurns,
          status: 'error',
          error: code,
          now: input.now ?? Date.now(),
        });
        return finalized
          ? {
              conversationId: conv.id,
              seededTurns: seededTurns - startingSeededTurns,
              remainingTurns: turns.length - results.length,
              status: 'error',
              claimOutcome: 'acquired',
              results,
              error: code,
            }
          : claimLostResult(
              conv.id,
              seededTurns - startingSeededTurns,
              turns.length - results.length,
              results,
            );
      }
      if (!renewMigrationClaim(conv.id, claim.token, input.now ?? Date.now())) {
        return claimLostResult(
          conv.id,
          seededTurns - startingSeededTurns,
          turns.length - results.length,
          results,
        );
      }
      if (!input.dryRun) {
        const nextSeededTurns = seededTurns + 1;
        const checkpointAt = input.now ?? Date.now();
        applyConsolidatorResult(outcome.result, {
          now: turnNow,
          conversationId: conv.id,
          threadId: conv.id,
          threadTitle: conv.title,
          sourceUserMessageId: turn.userMessage.id,
          sourceAssistantMessageId: turn.assistantMessage.id,
          factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.migrationSeedProvider,
          messages: [turn.userMessage, turn.assistantMessage],
          episodeAccess: {
            personaId: resolveCodeOwnedMemoryPersonaId(conv.personaId),
            shareability: 'thread_only',
          },
          canPersist: () => isMemoryPolicyEpochCurrent(policyEpoch),
          commitReceipt: () =>
            checkpointMigrationTurn({
              conversationId: conv.id,
              claimToken: claim.token,
              lastSeededMessageId: turn.assistantMessage.id,
              seededTurns: nextSeededTurns,
              now: checkpointAt,
            }),
        });
      }
      results.push(outcome.result);
      lastSeededMessageId = turn.assistantMessage.id;
      seededTurns += 1;
    } catch {
      const code: MigrationErrorCode = 'persistence_failed';
      logger.warn?.('seed persistence failed (persistence_failed)');
      const finalized = finalizeMigrationClaim({
        conversationId: conv.id,
        token: claim.token,
        lastSeededMessageId,
        seededTurns,
        status: 'error',
        error: code,
        now: input.now ?? Date.now(),
      });
      return finalized
        ? {
            conversationId: conv.id,
            seededTurns: seededTurns - startingSeededTurns,
            remainingTurns: turns.length - results.length,
            status: 'error',
            claimOutcome: 'acquired',
            results,
            error: code,
          }
        : claimLostResult(
            conv.id,
            seededTurns - startingSeededTurns,
            turns.length - results.length,
            results,
          );
    }
  }

  const remaining = turns.length - slice.length;
  const status: MigrationStatus = remaining === 0 ? 'completed' : 'in_progress';
  const finalized = finalizeMigrationClaim({
    conversationId: conv.id,
    token: claim.token,
    lastSeededMessageId,
    seededTurns,
    status,
    error: null,
    now: input.now ?? Date.now(),
  });
  return finalized
    ? {
        conversationId: conv.id,
        seededTurns: slice.length,
        remainingTurns: remaining,
        status,
        claimOutcome: 'acquired',
        results,
      }
    : claimLostResult(conv.id, seededTurns - startingSeededTurns, remaining, results);
}

function claimLostResult(
  conversationId: string,
  seededTurns: number,
  remainingTurns: number,
  results: ConsolidatorResult[],
): SeedConversationResult {
  return {
    conversationId,
    seededTurns,
    remainingTurns,
    status: 'error',
    claimOutcome: 'acquired',
    results,
    error: 'claim_lost',
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
  if (input.disableLongTermMemory || !canWriteLongTermMemory()) {
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
    const result = await seedConversation({
      conversation: conv,
      extractor: input.extractor,
      maxTurnsPerCall: input.maxTurnsPerCall,
      now: input.now,
    });
    if (result.claimOutcome !== 'acquired') {
      counters.skipped += 1;
      if (result.remainingTurns > 0) {
        counters.pending.push(conv.id);
        counters.remainingConversations += 1;
      }
      continue;
    }
    counters.attempted += 1;
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
